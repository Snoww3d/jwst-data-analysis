#!/usr/bin/env python3
"""
Orchestration script to seed the Astronomy app with demo data.
1. Creates a set of dummy FITS files in the shared Docker volume.
2. Calls the Backend API to ingest these files as an "import".
"""

import os
import sys
import time
import requests
import subprocess
from pathlib import Path

# Configuration
BASE_URL = "http://localhost:5001/api"
DEMO_OBS_ID = "DEMO_DATA_001"
DATA_DIR_NAME = "data/mast"  # Relative to project root
PROJECT_ROOT = Path(__file__).parent.parent.absolute()
SCRIPT_PATH = PROJECT_ROOT / "scripts" / "generate_test_data.py"

def check_backend_health():
    """Wait for backend to be ready."""
    url = f"{BASE_URL}/health" # Or checking a simple endpoint if health not exists, likely MastController has no root
    # Checking MAST controller specific endpoint to be sure
    url = f"{BASE_URL}/Mast/import/resumable"
    
    print("Waiting for backend connectivity...")
    for i in range(10):
        try:
            response = requests.get(url, timeout=2)
            if response.status_code == 200:
                print("Backend is online.")
                return True
        except requests.exceptions.ConnectionError:
            pass
        
        time.sleep(1)
        print(".")
    
    print("Error: Could not connect to backend at", BASE_URL)
    return False

def generate_files():
    """Generate a suite of demo files."""
    
    # We need to write to the 'data' directory that is mounted in Docker.
    # In docker-compose.yml: - ../data:/app/data
    # So we write to PROJECT_ROOT/data/mast/{DEMO_OBS_ID}/
    
    output_dir = PROJECT_ROOT / "data" / "mast" / DEMO_OBS_ID
    if output_dir.exists():
        print(f"Cleaning existing demo data at {output_dir}")
        # rm -rf (be careful)
        for item in output_dir.glob("*"):
            item.unlink()
    else:
        output_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"Generating FITS files in {output_dir}...")
    
    scenarios = [
        {
            "type": "nebula", 
            "filename": "jw02733002001_02101_00001_nircam_clear-f200w_i2d.fits",
            "target": "Carina Nebula Sim",
            "filter": "F200W"
        },
         {
            "type": "deepfield", 
            "filename": "jw02733002001_02101_00001_nircam_clear-f444w_i2d.fits",
            "target": "Deep Field Sim",
            "filter": "F444W"
        },
         {
            "type": "cluster", 
            "filename": "jw02733002001_02101_00001_nircam_clear-f115w_i2d.fits",
            "target": "Star Cluster Sim",
            "filter": "F115W"
        }
    ]
    
    for s in scenarios:
        out_path = output_dir / s["filename"]
        cmd = [
            sys.executable, str(SCRIPT_PATH),
            "--output", str(out_path),
            "--type", s["type"],
            "--width", "800",
            "--height", "600",
            "--target", s["target"],
            "--filter", s["filter"]
        ]
        
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            print(f"Failed to generate {s['filename']}: {proc.stderr}")
            return False
            
    return True

def trigger_import():
    """Call the API to import the files we just made."""
    url = f"{BASE_URL}/Mast/import/from-existing/{DEMO_OBS_ID}"
    print(f"Triggering import via {url}...")
    
    try:
        response = requests.post(url)
        if response.status_code == 200:
            data = response.json()
            print("Import started successfully!")
            print(f"Job ID: {data.get('jobId')}")
            print(f"Message: {data.get('message')}")
            return True
        else:
            print(f"Import failed: {response.status_code} - {response.text}")
            return False
    except Exception as e:
        print(f"Exception during import trigger: {e}")
        return False

def main():
    print("--- DEMO DATA SEEDER ---")
    
    if not check_backend_health():
        sys.exit(1)
        
    if not generate_files():
        print("File generation failed.")
        sys.exit(1)
        
    if not trigger_import():
        print("Import trigger failed.")
        sys.exit(1)
        
    print("\nSUCCESS! Demo data seeded. Go to Dashboard -> Observations to see 'DEMO_DATA_001'.")

if __name__ == "__main__":
    main()
