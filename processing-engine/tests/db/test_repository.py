"""Read-repository semantics — mirrors the .NET anonymous-access suite.

Anonymous (CE) visibility = IsPublic only; the .NET SetupAnonymousUser tests
are the reference behavior. Uses an in-memory fake motor collection so no
Mongo instance is needed.
"""

import pytest
from bson import ObjectId

from app.db.repository import JwstDataReadRepository
from tests.db.fakes import FakeCollection


def make_doc(
    *,
    oid=None,
    public=True,
    archived=False,
    file_path="mast/jw1/f1.fits",
    level="L3",
    obs_base="jw01",
    user_id=None,
    thumb=None,
    mast_obs_id=None,
):
    doc = {
        "_id": oid or ObjectId(),
        "FileName": "f1.fits",
        "DataType": "image",
        "IsPublic": public,
        "IsArchived": archived,
        "FilePath": file_path,
        "ProcessingLevel": level,
        "ObservationBaseId": obs_base,
        "UserId": user_id,
        "ThumbnailData": thumb,
        "Metadata": {"mast_obs_id": mast_obs_id} if mast_obs_id else {},
        "ImageInfo": {"Filter": "F770W"},
        "ProcessingResults": [],
        "Tags": [],
        "SharedWith": [],
        "Version": 1,
    }
    return doc


@pytest.fixture
def repo_with(request):
    def _build(docs):
        return JwstDataReadRepository(FakeCollection(docs))

    return _build


class TestPublicList:
    @pytest.mark.asyncio
    async def test_anonymous_sees_only_public(self, repo_with):
        docs = [make_doc(public=True), make_doc(public=False), make_doc(public=True)]
        repo = repo_with(docs)
        out = await repo.get_public_list(include_archived=True)
        assert len(out) == 2
        assert all(d["IsPublic"] for d in out)

    @pytest.mark.asyncio
    async def test_owned_private_docs_excluded(self, repo_with):
        # a doc owned by some user and not public must never surface anonymously
        docs = [make_doc(public=False, user_id="u1")]
        repo = repo_with(docs)
        assert await repo.get_public_list(include_archived=True) == []

    @pytest.mark.asyncio
    async def test_archived_excluded_by_default(self, repo_with):
        docs = [make_doc(archived=True), make_doc(archived=False)]
        repo = repo_with(docs)
        out = await repo.get_public_list(include_archived=False)
        assert len(out) == 1
        assert out[0]["IsArchived"] is False

    @pytest.mark.asyncio
    async def test_include_archived_true(self, repo_with):
        docs = [make_doc(archived=True), make_doc(archived=False)]
        repo = repo_with(docs)
        assert len(await repo.get_public_list(include_archived=True)) == 2


class TestGetByIdPublic:
    @pytest.mark.asyncio
    async def test_returns_public_doc(self, repo_with):
        oid = ObjectId()
        repo = repo_with([make_doc(oid=oid)])
        doc = await repo.get_public_by_id(str(oid))
        assert doc is not None and doc["_id"] == oid

    @pytest.mark.asyncio
    async def test_private_doc_hidden(self, repo_with):
        oid = ObjectId()
        repo = repo_with([make_doc(oid=oid, public=False)])
        assert await repo.get_public_by_id(str(oid)) is None

    @pytest.mark.asyncio
    async def test_invalid_id_returns_none(self, repo_with):
        repo = repo_with([])
        assert await repo.get_public_by_id("not-an-objectid") is None


class TestThumbnail:
    @pytest.mark.asyncio
    async def test_thumbnail_bytes(self, repo_with):
        oid = ObjectId()
        repo = repo_with([make_doc(oid=oid, thumb=b"\x89PNG...")])
        assert await repo.get_public_thumbnail(str(oid)) == b"\x89PNG..."

    @pytest.mark.asyncio
    async def test_no_thumbnail_returns_none(self, repo_with):
        oid = ObjectId()
        repo = repo_with([make_doc(oid=oid, thumb=None)])
        assert await repo.get_public_thumbnail(str(oid)) is None

    @pytest.mark.asyncio
    async def test_private_thumbnail_hidden(self, repo_with):
        oid = ObjectId()
        repo = repo_with([make_doc(oid=oid, public=False, thumb=b"png")])
        assert await repo.get_public_thumbnail(str(oid)) is None


class TestByObservationBase:
    @pytest.mark.asyncio
    async def test_finds_by_observation_base_id(self, repo_with):
        repo = repo_with([make_doc(obs_base="jw02733002001")])
        out = await repo.get_public_by_observation_base_id("jw02733002001")
        assert len(out) == 1

    @pytest.mark.asyncio
    async def test_falls_back_to_mast_obs_id(self, repo_with):
        # .NET MongoDBService.cs:609 fallback semantics
        repo = repo_with([make_doc(obs_base="other", mast_obs_id="jw02733-o002_t001")])
        out = await repo.get_public_by_observation_base_id("jw02733-o002_t001")
        assert len(out) == 1

    @pytest.mark.asyncio
    async def test_private_records_filtered(self, repo_with):
        repo = repo_with(
            [make_doc(obs_base="jw01", public=False), make_doc(obs_base="jw01", public=True)]
        )
        out = await repo.get_public_by_observation_base_id("jw01")
        assert len(out) == 1 and out[0]["IsPublic"]
