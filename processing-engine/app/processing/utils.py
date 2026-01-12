import numpy as np
from astropy.io import fits
import logging
from typing import Tuple, Dict, Any, Optional
import os

logger = logging.getLogger(__name__)

def load_fits_data(file_path: str) -> Tuple[Optional[np.ndarray], Dict[str, Any]]:
    """
    Load data and header from a FITS file.
    
    Args:
        file_path: Path to the FITS file
        
    Returns:
        Tuple containing the data array and header dictionary
    """
    try:
        if not os.path.exists(file_path):
            logger.error(f"File not found: {file_path}")
            return None, {}
            
        with fits.open(file_path) as hdul:
            # Assume primary extension contains the data we want for now
            # In real JWST data, science data might be in 'SCI' extension
            # We'll try to find the first extension with data
            
            data = None
            header = {}
            
            for hdu in hdul:
                if hdu.data is not None:
                    data = hdu.data
                    header = dict(hdu.header)
                    break
            
            if data is None:
                logger.warning(f"No data found in FITS file: {file_path}")
                return None, {}
                
            return data, header
            
    except Exception as e:
        logger.error(f"Error loading FITS file {file_path}: {str(e)}")
        return None, {}

def save_fits_data(data: np.ndarray, header: Dict[str, Any], output_path: str) -> bool:
    """
    Save data to a FITS file.
    
    Args:
        data: Numpy array of data
        header: Dictionary of header keywords
        output_path: Path to save the file
        
    Returns:
        True if successful, False otherwise
    """
    try:
        hdu = fits.PrimaryHDU(data=data)
        
        # Add header keywords
        for key, value in header.items():
            # Skip some standard keys that astropy handles or might conflict
            if key not in ['SIMPLE', 'BITPIX', 'NAXIS', 'EXTEND']:
                try:
                    hdu.header[key] = value
                except Exception:
                    pass # Skip invalid header items
                    
        hdu.writeto(output_path, overwrite=True)
        return True
        
    except Exception as e:
        logger.error(f"Error saving FITS file {output_path}: {str(e)}")
        return False

def normalize_array(data: np.ndarray) -> np.ndarray:
    """
    Normalize array to 0-1 range.
    """
    if data is None:
        return None
        
    min_val = np.nanmin(data)
    max_val = np.nanmax(data)
    
    if max_val == min_val:
        return np.zeros_like(data)
        
    return (data - min_val) / (max_val - min_val)
