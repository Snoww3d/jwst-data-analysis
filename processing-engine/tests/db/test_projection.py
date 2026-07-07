"""Projection edge cases found by the live .NET-vs-Python parity diff."""

from bson import ObjectId

from app.db.projection import to_data_response


def test_bson_type_discriminators_unwrapped():
    # mosaic-generator docs store Metadata.source_ids as a typed .NET
    # collection: {"_t": "System.Collections.Generic.List`1[...]", "_v": [...]}
    doc = {
        "_id": ObjectId(),
        "FileName": "m.fits",
        "IsPublic": True,
        "Metadata": {
            "source": "mosaic-generator",
            "source_ids": {
                "_t": "System.Collections.Generic.List`1[[System.String]]",
                "_v": ["a", "b"],
            },
        },
    }
    out = to_data_response(doc)
    assert out["metadata"]["source_ids"] == ["a", "b"]


def test_literal_t_v_dict_with_extra_keys_untouched():
    doc = {
        "_id": ObjectId(),
        "FileName": "x.fits",
        "IsPublic": True,
        "Metadata": {"weird": {"_t": 1, "_v": 2, "other": 3}},
    }
    out = to_data_response(doc)
    assert out["metadata"]["weird"] == {"_t": 1, "_v": 2, "other": 3}
