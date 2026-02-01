#!/usr/bin/env python3
"""
Script to generate synthetic FITS data for testing purposes.
Creates FITS files with various known patterns (nebula, deep field, star clusters) 
and realistic JWST-like headers to test visualization and categorization features.
"""

import argparse
import os
import sys
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from astropy.io import fits


class ImageGenerator:
    """Base class for generating astronomical images."""
    
    def __init__(self, width=1024, height=1024, seed=None):
        self.width = width
        self.height = height
        self.rng = np.random.default_rng(seed)
        
    def generate(self):
        raise NotImplementedError
        
    def add_noise(self, data, level=0.01):
        noise = self.rng.normal(0, level, (self.height, self.width))
        return data + noise
        
    def add_stars(self, data, count=50, max_amp=2.0, min_sigma=0.5, max_sigma=3.0):
        xv, yv = np.meshgrid(np.arange(self.width), np.arange(self.height))
        
        for _ in range(count):
            sx = self.rng.integers(0, self.width)
            sy = self.rng.integers(0, self.height)
            amp = self.rng.random() * max_amp
            sigma = self.rng.random() * (max_sigma - min_sigma) + min_sigma
            
            # Gaussian star profile
            dist_sq = (xv - sx)**2 + (yv - sy)**2
            star = amp * np.exp(-dist_sq / (2 * sigma**2))
            
            # Simple diffraction spikes for brighter stars
            if amp > 1.0:
                # Vertical/Horizontal spikes
                factor = 0.05 * amp
                spike_width = 1.0
                
                # Horizontal
                dist_y = np.abs(yv - sy)
                spike_h = factor * np.exp(-dist_y / spike_width) * (1 / (1 + 0.1 * np.abs(xv - sx)))
                
                # Vertical
                dist_x = np.abs(xv - sx)
                spike_v = factor * np.exp(-dist_x / spike_width) * (1 / (1 + 0.1 * np.abs(yv - sy)))
                
                star += spike_h + spike_v
                
            data += star
        return data

    def normalize(self, data):
        # Shift to positive and avoid true zero
        data = data + abs(min(0, data.min())) + 0.1
        return data


class NebulaGenerator(ImageGenerator):
    """Generates a cloud-like nebula structure using Perlin-ish noise combination."""
    
    def generate(self):
        # Create coordinate grid
        x = np.linspace(0, 10, self.width)
        y = np.linspace(0, 10, self.height)
        xv, yv = np.meshgrid(x, y)
        
        # Combine sine waves to simulate cloud structure (poor man's Perlin)
        data = np.zeros((self.height, self.width))
        
        # Layer 1: Base structure
        data += np.sin(xv * 0.5 + yv * 0.3) * 0.5
        
        # Layer 2: Detail
        data += np.sin(xv * 1.5 - yv * 0.8) * 0.25
        
        # Layer 3: Finer detail
        data += np.cos(xv * 3.0 + yv * 2.5) * 0.125
        
        # Create a central glow
        cx, cy = 5, 5
        dist = np.sqrt((xv - cx)**2 + (yv - cy)**2)
        glow = np.exp(-dist / 3.0)
        
        data = (data * 0.4 + glow * 0.8)
        
        # Add stars
        data = self.add_stars(data, count=200, max_amp=3.0)
        data = self.add_noise(data, level=0.02)
        
        return self.normalize(data)


class DeepFieldGenerator(ImageGenerator):
    """Generates a field with many galaxies and stars."""
    
    def generate(self):
        data = np.zeros((self.height, self.width))
        xv, yv = np.meshgrid(np.arange(self.width), np.arange(self.height))
        
        # Add galaxies (elliptical shapes)
        n_galaxies = 15
        for _ in range(n_galaxies):
            gx = self.rng.integers(0, self.width)
            gy = self.rng.integers(0, self.height)
            amp = self.rng.random() * 0.8 + 0.2
            
            # Rotation angle
            theta = self.rng.random() * np.pi
            
            # Scale
            sx = self.rng.random() * 40 + 10
            sy = sx * (self.rng.random() * 0.5 + 0.2)
            
            # Rotate coordinates
            dx = xv - gx
            dy = yv - gy
            dx_rot = dx * np.cos(theta) - dy * np.sin(theta)
            dy_rot = dx * np.sin(theta) + dy * np.cos(theta)
            
            galaxy = amp * np.exp(-(dx_rot**2 / (2 * sx**2) + dy_rot**2 / (2 * sy**2)))
            data += galaxy
            
        # Add many stars
        data = self.add_stars(data, count=500, max_amp=1.5, max_sigma=2.0)
        data = self.add_noise(data, level=0.005)
        
        return self.normalize(data)


class StarClusterGenerator(ImageGenerator):
    """Generates a dense cluster of stars."""
    
    def generate(self):
        data = np.zeros((self.height, self.width))
        xv, yv = np.meshgrid(np.arange(self.width), np.arange(self.height))
        
        center_x = self.width / 2
        center_y = self.height / 2
        
        # Cluster parameters
        cluster_radius = self.width / 4
        n_stars = 1000
        
        for _ in range(n_stars):
            # Sample position from 2D Gaussian distribution
            # Box-Muller transform for radius/angle
            r = abs(self.rng.normal(0, cluster_radius))
            theta = self.rng.random() * 2 * np.pi
            
            sx = int(center_x + r * np.cos(theta))
            sy = int(center_y + r * np.sin(theta))
            
            if 0 <= sx < self.width and 0 <= sy < self.height:
                amp = self.rng.random() * 1.5 + 0.1
                sigma = self.rng.random() * 1.5 + 0.5
                
                # Simplified star rendering for performance
                dist_sq = (xv - sx)**2 + (yv - sy)**2
                # Limit influence to 5 sigma for speed
                mask = dist_sq < (5 * sigma)**2
                
                if np.any(mask):
                    star = np.zeros_like(data)
                    star[mask] = amp * np.exp(-dist_sq[mask] / (2 * sigma**2))
                    data += star
                    
        # Add a few bright foreground stars with spikes
        data = self.add_stars(data, count=10, max_amp=5.0)
        data = self.add_noise(data, level=0.01)
        
        return self.normalize(data)


def save_fits(data, output_path, meta):
    """
    Save data to a FITS file with realistic formatting.
    """
    hdu = fits.PrimaryHDU(data)
    
    # Standard FITS keywords
    hdu.header['DATE'] = datetime.now(timezone.utc).isoformat()
    hdu.header['ORIGIN'] = 'JWST-DATA-ANALYSIS-DEMO'
    hdu.header['TELESCOP'] = 'JWST'
    hdu.header['INSTRUME'] = meta.get('instrument', 'NIRCAM')
    hdu.header['DETECTOR'] = meta.get('detector', 'NRCA1')
    hdu.header['FILTER'] = meta.get('filter', 'F200W')
    hdu.header['TARGNAME'] = meta.get('target', 'UNKNOWN')
    hdu.header['PI_NAME'] = 'ANTIGRAVITY'
    hdu.header['OBS_ID'] = 'DEMO_DATA'
    hdu.header['PROGRAM'] = '99999'
    
    # WCS Coordinates (Fake but valid syntax)
    hdu.header['CTYPE1'] = 'RA---TAN'
    hdu.header['CTYPE2'] = 'DEC--TAN'
    hdu.header['CRPIX1'] = data.shape[1] / 2
    hdu.header['CRPIX2'] = data.shape[0] / 2
    hdu.header['CRVAL1'] = 180.0
    hdu.header['CRVAL2'] = 45.0
    hdu.header['CDELT1'] = -2.7e-5  # approx 0.1 arcsec/pixel
    hdu.header['CDELT2'] = 2.7e-5
    
    # Unit
    hdu.header['BUNIT'] = 'MJy/sr'
    
    hdul = fits.HDUList([hdu])
    hdul.writeto(output_path, overwrite=True)
    print(f"[{meta.get('type')}] Created {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Generate synthetic FITS data for testing.")
    parser.add_argument("--output", "-o", type=str, required=True, help="Output file path")
    parser.add_argument("--type", type=str, choices=['nebula', 'deepfield', 'cluster'], default='nebula', help="Type of image to generate")
    parser.add_argument("--width", type=int, default=512, help="Image width")
    parser.add_argument("--height", type=int, default=512, help="Image height")
    parser.add_argument("--target", type=str, help="Target name for header")
    parser.add_argument("--instrument", type=str, default="NIRCAM", help="Instrument name")
    parser.add_argument("--filter", type=str, default="F200W", help="Filter name")
    
    args = parser.parse_args()
    
    print(f"Generating {args.type} image ({args.width}x{args.height})...")
    
    generators = {
        'nebula': NebulaGenerator,
        'deepfield': DeepFieldGenerator,
        'cluster': StarClusterGenerator
    }
    
    gen_class = generators.get(args.type, NebulaGenerator)
    generator = gen_class(width=args.width, height=args.height, seed=42)
    
    data = generator.generate()
    
    meta = {
        'type': args.type,
        'target': args.target or f"Synthetic {args.type.title()}",
        'instrument': args.instrument,
        'detector': f"NRC{args.type[0].upper()}1",
        'filter': args.filter
    }
    
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    save_fits(data, output_path, meta)


if __name__ == "__main__":
    main()
