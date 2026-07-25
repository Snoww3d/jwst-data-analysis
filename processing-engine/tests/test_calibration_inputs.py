# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""Resolving library ids to calibration input keys (#1751).

The bug this fixes: the library DTO never publishes FilePath, so a client
literally could not send a storage key, and every library-input path in the UI
was silently empty. Ids are resolved server-side instead.
"""

import uuid

import pytest
from bson import ObjectId

from app.calibration.inputs import InputResolutionError, resolve_input_data_ids
from app.db.client import get_database, reset_client


OWNER = "user-a"
OTHER = "user-b"


@pytest.fixture()
async def library():
    reset_client()
    collection = get_database()[f"jwst_data_test_{uuid.uuid4().hex}"]
    yield collection
    await collection.drop()
    reset_client()


async def seed(collection, **over) -> str:
    doc = {
        "FileName": "a_cal.fits",
        "FilePath": "mast/jw1/a_cal.fits",
        "UserId": OWNER,
        "IsPublic": False,
        **over,
    }
    result = await collection.insert_one(doc)
    return str(result.inserted_id)


class TestResolveInputDataIds:
    async def test_returns_relative_keys_in_the_callers_order(self, library) -> None:
        first = await seed(library, FilePath="mast/jw1/a_cal.fits")
        second = await seed(library, FilePath="mast/jw1/b_cal.fits")

        keys = await resolve_input_data_ids(library, [second, first], user_id=OWNER)

        # Order matters: it decides how exposures are associated into a mosaic.
        assert keys == ["mast/jw1/b_cal.fits", "mast/jw1/a_cal.fits"]

    async def test_strips_the_container_data_prefix(self, library) -> None:
        data_id = await seed(library, FilePath="/app/data/mast/jw1/a_cal.fits")
        keys = await resolve_input_data_ids(library, [data_id], user_id=OWNER)
        assert keys == ["mast/jw1/a_cal.fits"]

    async def test_public_items_are_usable_by_anyone(self, library) -> None:
        data_id = await seed(library, UserId=OTHER, IsPublic=True)
        assert await resolve_input_data_ids(library, [data_id], user_id=OWNER)

    async def test_someone_elses_private_item_is_refused(self, library) -> None:
        data_id = await seed(library, UserId=OTHER, IsPublic=False)
        with pytest.raises(InputResolutionError, match="not found"):
            await resolve_input_data_ids(library, [data_id], user_id=OWNER)

    async def test_item_shared_with_the_caller_is_usable(self, library) -> None:
        # Mirrors the .NET FilterAccessibleData SharedWith branch: these items
        # show up in the caller's library, so they must be selectable too.
        data_id = await seed(library, UserId=OTHER, IsPublic=False, SharedWith=[OWNER])
        assert await resolve_input_data_ids(library, [data_id], user_id=OWNER)

    async def test_shared_with_someone_else_is_still_refused(self, library) -> None:
        data_id = await seed(library, UserId=OTHER, IsPublic=False, SharedWith=["user-c"])
        with pytest.raises(InputResolutionError, match="not found"):
            await resolve_input_data_ids(library, [data_id], user_id=OWNER)

    async def test_archived_item_is_refused(self, library) -> None:
        data_id = await seed(library, IsArchived=True)
        with pytest.raises(InputResolutionError, match="archived"):
            await resolve_input_data_ids(library, [data_id], user_id=OWNER)

    async def test_duplicate_ids_are_refused(self, library) -> None:
        # Silently de-duplicating would change the association; double-counting
        # would over-weight one exposure. Neither is a safe guess.
        data_id = await seed(library)
        with pytest.raises(InputResolutionError, match="duplicate"):
            await resolve_input_data_ids(library, [data_id, data_id], user_id=OWNER)

    async def test_does_not_load_thumbnail_blobs(self, library) -> None:
        # These documents carry binary ThumbnailData; pulling it for every
        # input would move megabytes to authorize a path lookup.
        data_id = await seed(library, ThumbnailData=b"x" * 32)
        assert await resolve_input_data_ids(library, [data_id], user_id=OWNER)

    async def test_admin_may_use_any_item(self, library) -> None:
        data_id = await seed(library, UserId=OTHER, IsPublic=False)
        assert await resolve_input_data_ids(library, [data_id], user_id=OWNER, is_admin=True)

    async def test_unknown_id_reads_the_same_as_not_visible(self, library) -> None:
        # Same message on purpose — otherwise a caller could probe for ids.
        missing = str(ObjectId())
        with pytest.raises(InputResolutionError, match="not found"):
            await resolve_input_data_ids(library, [missing], user_id=OWNER)

    async def test_item_without_a_file_is_refused(self, library) -> None:
        data_id = await seed(library, FilePath=None)
        with pytest.raises(InputResolutionError, match="no file"):
            await resolve_input_data_ids(library, [data_id], user_id=OWNER)

    async def test_never_silently_drops_an_input(self, library) -> None:
        # A run that quietly used fewer frames than asked would produce a wrong
        # mosaic with no indication why, so one bad id fails the whole request.
        good = await seed(library)
        bad = str(ObjectId())
        with pytest.raises(InputResolutionError):
            await resolve_input_data_ids(library, [good, bad], user_id=OWNER)

    async def test_malformed_id_is_rejected(self, library) -> None:
        with pytest.raises(InputResolutionError, match="valid library id"):
            await resolve_input_data_ids(library, ["not-an-objectid"], user_id=OWNER)

    async def test_empty_list_is_fine(self, library) -> None:
        assert await resolve_input_data_ids(library, [], user_id=OWNER) == []
