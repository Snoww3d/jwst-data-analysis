"""
MAST (Mikulski Archive for Space Telescopes) service for querying and downloading JWST data.
Uses astroquery.mast for all MAST portal interactions.
"""

from astroquery.mast import Observations
from astropy.coordinates import SkyCoord
import astropy.units as u
from typing import Dict, Any, List, Optional, Callable
import os
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

# Type alias for progress callback
ProgressCallback = Callable[[str, int, int], None]  # (filename, current, total)


class MastService:
    """Service for interacting with MAST portal via astroquery."""

    # Default page size for MAST queries (astroquery defaults to 10)
    DEFAULT_PAGE_SIZE = 500

    def __init__(self, download_dir: str = "/app/data/mast"):
        self.download_dir = download_dir
        os.makedirs(download_dir, exist_ok=True)

    def search_by_target(
        self,
        target_name: str,
        radius: float = 0.2,
        filters: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Search MAST by target name (e.g., 'NGC 1234', 'Carina Nebula').

        Args:
            target_name: Astronomical object name
            radius: Search radius in degrees
            filters: Additional query filters

        Returns:
            List of observation dictionaries
        """
        try:
            logger.info(f"Searching MAST for target: {target_name}, radius: {radius} deg")
            obs_table = Observations.query_object(
                target_name,
                radius=radius * u.deg,
                pagesize=self.DEFAULT_PAGE_SIZE
            )
            # Filter to JWST observations
            if len(obs_table) > 0:
                jwst_mask = obs_table['obs_collection'] == 'JWST'
                obs_table = obs_table[jwst_mask]

            logger.info(f"Found {len(obs_table)} JWST observations")
            return self._table_to_dict_list(obs_table)
        except Exception as e:
            logger.error(f"MAST target search failed: {e}")
            raise

    def search_by_coordinates(
        self,
        ra: float,
        dec: float,
        radius: float = 0.2
    ) -> List[Dict[str, Any]]:
        """
        Search MAST by RA/Dec coordinates.

        Args:
            ra: Right Ascension in degrees
            dec: Declination in degrees
            radius: Search radius in degrees

        Returns:
            List of observation dictionaries
        """
        try:
            logger.info(f"Searching MAST at RA={ra}, Dec={dec}, radius={radius} deg")
            coord = SkyCoord(ra=ra, dec=dec, unit="deg")
            obs_table = Observations.query_region(
                coord,
                radius=radius * u.deg,
                pagesize=self.DEFAULT_PAGE_SIZE
            )
            # Filter to JWST observations
            if len(obs_table) > 0:
                jwst_mask = obs_table['obs_collection'] == 'JWST'
                obs_table = obs_table[jwst_mask]

            logger.info(f"Found {len(obs_table)} JWST observations")
            return self._table_to_dict_list(obs_table)
        except Exception as e:
            logger.error(f"MAST coordinate search failed: {e}")
            raise

    def search_by_observation_id(
        self,
        obs_id: str
    ) -> List[Dict[str, Any]]:
        """
        Search MAST by observation ID.

        Args:
            obs_id: MAST observation ID

        Returns:
            List of observation dictionaries
        """
        try:
            logger.info(f"Searching MAST for observation ID: {obs_id}")
            obs_table = Observations.query_criteria(
                obs_id=obs_id,
                obs_collection="JWST",
                pagesize=self.DEFAULT_PAGE_SIZE
            )
            logger.info(f"Found {len(obs_table)} observations")
            return self._table_to_dict_list(obs_table)
        except Exception as e:
            logger.error(f"MAST observation ID search failed: {e}")
            raise

    def search_by_program_id(
        self,
        program_id: str
    ) -> List[Dict[str, Any]]:
        """
        Search MAST by program/proposal ID.

        Args:
            program_id: JWST program/proposal ID

        Returns:
            List of observation dictionaries
        """
        try:
            logger.info(f"Searching MAST for program ID: {program_id}")
            obs_table = Observations.query_criteria(
                proposal_id=program_id,
                obs_collection="JWST",
                pagesize=self.DEFAULT_PAGE_SIZE
            )
            logger.info(f"Found {len(obs_table)} observations")
            return self._table_to_dict_list(obs_table)
        except Exception as e:
            logger.error(f"MAST program ID search failed: {e}")
            raise

    def get_data_products(
        self,
        obs_id: str
    ) -> List[Dict[str, Any]]:
        """
        Get downloadable data products for an observation.

        Args:
            obs_id: Observation ID

        Returns:
            List of data product dictionaries
        """
        try:
            logger.info(f"Getting data products for observation: {obs_id}")
            # First get the observation
            obs_table = Observations.query_criteria(obs_id=obs_id)
            if len(obs_table) == 0:
                logger.warning(f"No observation found for ID: {obs_id}")
                return []

            # Get associated products
            products = Observations.get_product_list(obs_table)

            # Filter to science products (FITS files)
            filtered = Observations.filter_products(
                products,
                productType=["SCIENCE"],
                extension="fits"
            )
            logger.info(f"Found {len(filtered)} FITS science products")
            return self._table_to_dict_list(filtered)
        except Exception as e:
            logger.error(f"Failed to get data products: {e}")
            raise

    def download_product(
        self,
        product_id: str,
        obs_id: str
    ) -> Dict[str, Any]:
        """
        Download a specific data product from MAST.

        Args:
            product_id: Product ID or filename pattern
            obs_id: Observation ID

        Returns:
            Dict with download status and file paths
        """
        try:
            logger.info(f"Downloading product {product_id} for observation {obs_id}")
            # Create observation-specific subdirectory
            obs_dir = os.path.join(self.download_dir, obs_id)
            os.makedirs(obs_dir, exist_ok=True)

            # Get the product info
            obs_table = Observations.query_criteria(obs_id=obs_id)
            if len(obs_table) == 0:
                raise ValueError(f"Observation {obs_id} not found")

            products = Observations.get_product_list(obs_table)

            # Filter to the specific product
            mask = [product_id in str(fn) for fn in products['productFilename']]
            target_product = products[mask]

            if len(target_product) == 0:
                raise ValueError(f"Product {product_id} not found")

            # Download
            manifest = Observations.download_products(
                target_product,
                download_dir=obs_dir,
                cache=True
            )

            # Get the downloaded file paths
            downloaded_files = [str(p) for p in manifest['Local Path']]

            return {
                "status": "completed",
                "files": downloaded_files,
                "download_dir": obs_dir,
                "timestamp": datetime.utcnow().isoformat()
            }

        except Exception as e:
            logger.error(f"Download failed: {e}")
            return {
                "status": "failed",
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }

    def download_observation(
        self,
        obs_id: str,
        product_type: str = "SCIENCE"
    ) -> Dict[str, Any]:
        """
        Download all products for an observation.

        Args:
            obs_id: Observation ID
            product_type: Type of products to download (default: SCIENCE)

        Returns:
            Dict with download status and file paths
        """
        try:
            logger.info(f"Downloading all {product_type} products for observation: {obs_id}")
            obs_dir = os.path.join(self.download_dir, obs_id)
            os.makedirs(obs_dir, exist_ok=True)

            obs_table = Observations.query_criteria(obs_id=obs_id)
            if len(obs_table) == 0:
                raise ValueError(f"Observation {obs_id} not found")

            products = Observations.get_product_list(obs_table)
            filtered = Observations.filter_products(
                products,
                productType=[product_type],
                extension="fits"
            )

            if len(filtered) == 0:
                logger.warning(f"No {product_type} FITS products found for {obs_id}")
                return {
                    "status": "completed",
                    "obs_id": obs_id,
                    "files": [],
                    "file_count": 0,
                    "download_dir": obs_dir,
                    "timestamp": datetime.utcnow().isoformat()
                }

            logger.info(f"Downloading {len(filtered)} files...")
            manifest = Observations.download_products(
                filtered,
                download_dir=obs_dir,
                cache=True
            )

            downloaded_files = [str(p) for p in manifest['Local Path']]

            return {
                "status": "completed",
                "obs_id": obs_id,
                "files": downloaded_files,
                "file_count": len(downloaded_files),
                "download_dir": obs_dir,
                "timestamp": datetime.utcnow().isoformat()
            }

        except Exception as e:
            logger.error(f"Observation download failed: {e}")
            return {
                "status": "failed",
                "obs_id": obs_id,
                "error": str(e),
                "files": [],
                "file_count": 0,
                "timestamp": datetime.utcnow().isoformat()
            }

    def download_observation_with_progress(
        self,
        obs_id: str,
        product_type: str = "SCIENCE",
        progress_callback: Optional[ProgressCallback] = None
    ) -> Dict[str, Any]:
        """
        Download all products for an observation, one file at a time with progress updates.

        Args:
            obs_id: Observation ID
            product_type: Type of products to download (default: SCIENCE)
            progress_callback: Optional callback(filename, current, total) for progress updates

        Returns:
            Dict with download status and file paths
        """
        try:
            logger.info(f"Starting progressive download for observation: {obs_id}")
            obs_dir = os.path.join(self.download_dir, obs_id)
            os.makedirs(obs_dir, exist_ok=True)

            # Query for observation
            obs_table = Observations.query_criteria(obs_id=obs_id)
            if len(obs_table) == 0:
                raise ValueError(f"Observation {obs_id} not found")

            # Get product list
            products = Observations.get_product_list(obs_table)
            filtered = Observations.filter_products(
                products,
                productType=[product_type],
                extension="fits"
            )

            if len(filtered) == 0:
                logger.warning(f"No {product_type} FITS products found for {obs_id}")
                return {
                    "status": "completed",
                    "obs_id": obs_id,
                    "files": [],
                    "file_count": 0,
                    "download_dir": obs_dir,
                    "timestamp": datetime.utcnow().isoformat()
                }

            total_files = len(filtered)
            logger.info(f"Found {total_files} files to download for {obs_id}")
            downloaded_files = []

            # Download files one at a time
            for i, product in enumerate(filtered):
                filename = str(product['productFilename'])
                logger.info(f"Downloading file {i+1}/{total_files}: {filename}")

                if progress_callback:
                    progress_callback(filename, i, total_files)

                # Download single product
                single_product = filtered[i:i+1]
                try:
                    manifest = Observations.download_products(
                        single_product,
                        download_dir=obs_dir,
                        cache=True
                    )
                    if manifest and len(manifest) > 0:
                        filepath = str(manifest['Local Path'][0])
                        downloaded_files.append(filepath)
                        logger.info(f"Downloaded: {filepath}")
                except Exception as file_error:
                    logger.warning(f"Failed to download {filename}: {file_error}")
                    # Continue with other files

            # Final progress update
            if progress_callback:
                progress_callback("", total_files, total_files)

            return {
                "status": "completed",
                "obs_id": obs_id,
                "files": downloaded_files,
                "file_count": len(downloaded_files),
                "download_dir": obs_dir,
                "timestamp": datetime.utcnow().isoformat()
            }

        except Exception as e:
            logger.error(f"Progressive download failed: {e}")
            return {
                "status": "failed",
                "obs_id": obs_id,
                "error": str(e),
                "files": [],
                "file_count": 0,
                "timestamp": datetime.utcnow().isoformat()
            }

    def get_product_count(self, obs_id: str, product_type: str = "SCIENCE") -> int:
        """Get the number of downloadable products for an observation."""
        try:
            obs_table = Observations.query_criteria(obs_id=obs_id)
            if len(obs_table) == 0:
                return 0
            products = Observations.get_product_list(obs_table)
            filtered = Observations.filter_products(
                products,
                productType=[product_type],
                extension="fits"
            )
            return len(filtered)
        except Exception as e:
            logger.error(f"Failed to get product count: {e}")
            return 0

    def get_download_urls(
        self,
        obs_id: str,
        product_type: str = "SCIENCE"
    ) -> List[Dict[str, Any]]:
        """
        Get direct download URLs for observation products.

        Args:
            obs_id: Observation ID
            product_type: Type of products (default: SCIENCE)

        Returns:
            List of dicts with 'url', 'filename', and 'size' keys
        """
        try:
            logger.info(f"Getting download URLs for observation: {obs_id}")

            obs_table = Observations.query_criteria(obs_id=obs_id)
            if len(obs_table) == 0:
                raise ValueError(f"Observation {obs_id} not found")

            products = Observations.get_product_list(obs_table)
            filtered = Observations.filter_products(
                products,
                productType=[product_type],
                extension="fits"
            )

            if len(filtered) == 0:
                logger.warning(f"No {product_type} FITS products found for {obs_id}")
                return []

            # Extract download URLs from product list
            download_urls = []
            for product in filtered:
                filename = str(product['productFilename'])
                data_uri = str(product.get('dataURI', ''))
                size = int(product.get('size', 0)) if product.get('size') else 0

                # MAST data URIs are in format: mast:JWST/product/filename.fits
                # Convert to actual download URL
                if data_uri:
                    # Use MAST download service URL
                    download_url = f"https://mast.stsci.edu/api/v0.1/Download/file?uri={data_uri}"
                else:
                    # Fallback: construct URL from filename pattern
                    download_url = f"https://mast.stsci.edu/api/v0.1/Download/file?uri=mast:JWST/product/{filename}"

                download_urls.append({
                    "url": download_url,
                    "filename": filename,
                    "size": size,
                    "data_uri": data_uri
                })

            logger.info(f"Found {len(download_urls)} download URLs for {obs_id}")
            return download_urls

        except Exception as e:
            logger.error(f"Failed to get download URLs: {e}")
            raise

    def get_products_with_urls(
        self,
        obs_id: str,
        product_type: str = "SCIENCE"
    ) -> Dict[str, Any]:
        """
        Get product information including download URLs and total size.

        Args:
            obs_id: Observation ID
            product_type: Type of products (default: SCIENCE)

        Returns:
            Dict with 'products', 'total_files', 'total_bytes'
        """
        try:
            products = self.get_download_urls(obs_id, product_type)
            total_bytes = sum(p.get('size', 0) for p in products)

            return {
                "obs_id": obs_id,
                "products": products,
                "total_files": len(products),
                "total_bytes": total_bytes
            }
        except Exception as e:
            logger.error(f"Failed to get products with URLs: {e}")
            raise

    def _table_to_dict_list(self, table) -> List[Dict[str, Any]]:
        """Convert astropy Table to list of dicts using fast pandas conversion."""
        import math
        import numpy as np

        if table is None or len(table) == 0:
            return []

        try:
            # Use pandas for fast conversion (astropy tables have to_pandas method)
            df = table.to_pandas()

            # Replace NaN/Inf with None for JSON serialization
            df = df.replace([np.inf, -np.inf], np.nan)

            # Convert to list of dicts, replacing NaN with None
            result = df.where(df.notna(), None).to_dict(orient='records')

            # Ensure all values are JSON serializable (convert numpy types to Python types)
            for row in result:
                for key, val in row.items():
                    if hasattr(val, 'item'):
                        row[key] = val.item()
                    elif isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
                        row[key] = None

            return result

        except Exception as e:
            # Fallback to slower row-by-row conversion if pandas fails
            logger.warning(f"Fast table conversion failed, using fallback: {e}")
            result = []
            for row in table:
                row_dict = {}
                for col in table.colnames:
                    val = row[col]
                    # Handle masked values and numpy types
                    if hasattr(val, 'mask') and val.mask:
                        row_dict[col] = None
                    elif hasattr(val, 'item'):
                        item_val = val.item()
                        # Handle NaN and Inf values that aren't JSON serializable
                        if isinstance(item_val, float) and (math.isnan(item_val) or math.isinf(item_val)):
                            row_dict[col] = None
                        else:
                            row_dict[col] = item_val
                    elif isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
                        row_dict[col] = None
                    else:
                        row_dict[col] = str(val) if val is not None else None
                result.append(row_dict)
            return result
