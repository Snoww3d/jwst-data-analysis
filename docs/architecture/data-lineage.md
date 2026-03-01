# Data Lineage

JWST data products progress through processing levels. Files are grouped by `ObservationBaseId` for lineage tracking.

```mermaid
flowchart TB
    subgraph L1["Level 1 (L1) - Raw"]
        uncal["*_uncal.fits\nUncalibrated raw data"]
    end

    subgraph L2a["Level 2a - Rate"]
        rate["*_rate.fits\nCount rate images"]
        rateints["*_rateints.fits\nRate per integration"]
    end

    subgraph L2b["Level 2b - Calibrated"]
        cal["*_cal.fits\nCalibrated images"]
        calints["*_calints.fits\nCalibrated per integration"]
        crf["*_crf.fits\nCosmic ray flagged"]
    end

    subgraph L3["Level 3 - Combined"]
        i2d["*_i2d.fits\n2D resampled/combined"]
        s2d["*_s2d.fits\n2D spectral images"]
    end

    subgraph Tables["Table Products (non-viewable)"]
        asn["*_asn.fits\nAssociation tables"]
        x1d["*_x1d.fits\n1D extracted spectra"]
        cat["*_cat.fits\nSource catalogs"]
    end

    uncal --> rate
    uncal --> rateints
    rate --> cal
    rateints --> calints
    cal --> crf
    cal --> i2d
    cal --> s2d
    cal --> x1d
    i2d --> cat
    s2d --> cat

    style L1 fill:#6b2c2c,color:#f0f0f0,stroke:#e57373
    style L2a fill:#6b4c1e,color:#f0f0f0,stroke:#ffb74d
    style L2b fill:#5c5c1e,color:#f0f0f0,stroke:#fff176
    style L3 fill:#1e5c2c,color:#f0f0f0,stroke:#81c784
    style Tables fill:#4a4a4a,color:#f0f0f0,stroke:#bdbdbd
```

## Lineage Grouping

Files are grouped by observation for lineage visualization:

```mermaid
flowchart LR
    subgraph obs1["Observation: jw02733-o001_t001_nircam"]
        direction TB
        obs1_uncal["L1: _uncal.fits"]
        obs1_rate["L2a: _rate.fits"]
        obs1_cal["L2b: _cal.fits"]
        obs1_i2d["L3: _i2d.fits"]

        obs1_uncal --> obs1_rate --> obs1_cal --> obs1_i2d
    end

    subgraph obs2["Observation: jw02733-o001_t001_miri"]
        direction TB
        obs2_uncal["L1: _uncal.fits"]
        obs2_rate["L2a: _rate.fits"]
        obs2_cal["L2b: _cal.fits"]

        obs2_uncal --> obs2_rate --> obs2_cal
    end
```

---

[Back to Architecture Overview](index.md)
