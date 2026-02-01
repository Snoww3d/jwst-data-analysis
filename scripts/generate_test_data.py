#!/usr/bin/env python3
"""
Script to generate synthetic FITS data for testing purposes.
Creates a FITS file with a known pattern (gradient + noise) to test visualization and histogram features.
"""

import argparse
import os
import sys
from pathlib import Path

import numpy as np
from astropy.io import fits


def generate_test_image(width=500, height=500, noise_level=0.01):
    """
    Generate a synthetic test image with a gradient and noise.
    
    Args:
        width: Image width
        height: Image height
        noise_level: Standard deviation of Gaussian noise
        
    Returns:
        numpy.ndarray: The generated image data
    """
    # Create a meshgrid for the gradient
    x = np.linspace(0, 1, width)
    y = np.linspace(0, 1, height)
    xv, yv = np.meshgrid(x, y)
    
    # Create a nice pattern: Radial gradient + Linear gradient
    # Center at (0.3, 0.3)
    dist = np.sqrt((xv - 0.3)**2 + (yv - 0.3)**2)
    radial = np.exp(-dist * 5)
    
    # Linear gradient
    linear = (xv + yv) / 2
    
    # Combine
    data = 0.7 * radial + 0.3 * linear
    
    # Add fake "stars" (bright spots)
    n_stars = 20
    rng = np.random.default_rng(42)  # Fixed seed for reproducibility
    
    for _ in range(n_stars):
        sx = rng.integers(0, width)
        sy = rng.integers(0, height)
        amp = rng.random() * 2.0  # Brightness up to 2.0 (super bright)
        sigma = rng.random() * 2.0 + 0.5
        
        # Add simple Gaussian star
        dist_sq = (xv - sx/width)**2 + (yv - sy/height)**2
        # Normalize coordinates in exponential to pixels approx
        star = amp * np.exp(-dist_sq * (width*width) / (2 * sigma**2))
        data += star

    # Add noise
    noise = rng.normal(0, noise_level, (height, width))
    data += noise
    
    # Ensure positive capability (though FITS can handle negative, usually astronomical visual data is >= 0)
    # We'll shift slightly to avoid negative values from noise near 0
    data = data + abs(data.min()) + 0.001
    
    return data


def save_fits(data, output_path):
    """
    Save data to a FITS file.
    
    Args:
        data: The image data
        output_path: Path to write the file
    """
    hdu = fits.PrimaryHDU(data)
    hdu.header['OBJECT'] = 'TEST_IMAGE'
    hdu.header['COMMENT'] = 'Synthetic data generated for testing'
    
    hdul = fits.HDUList([hdu])
    hdul.writeto(output_path, overwrite=True)
    print(f"Successfully created FITS file at: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Generate synthetic FITS data for testing.")
    parser.add_argument("--output", "-o", type=str, help="Output file path (default: data/test_image.fits)")
    parser.add_argument("--width", type=int, default=500, help="Image width")
    parser.add_argument("--height", type=int, default=500, help="Image height")
    
    args = parser.parse_args()
    
    if args.output:
        output_path = Path(args.output)
    else:
        # Default to data/test_image.fits relative to script location or CWD
        # Assuming script is in /scripts and data is in /data
        base_dir = Path.cwd()
        if (base_dir / "data").exists():
            output_dir = base_dir / "data"
        else:
            # Fallback for creating it in current dir if structure is weird
            output_dir = base_dir
            
        output_path = output_dir / "test_image.fits"
    
    # Ensure directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    print(f"Generating {args.width}x{args.height} test image...")
    data = generate_test_image(width=args.width, height=args.height)
    
    save_fits(data, output_path)


if __name__ == "__main__":
    main()
