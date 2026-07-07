"""In-memory fake of the (tiny) motor collection surface the repository uses.

Supports the exact query shapes the read repository issues: equality matches,
dotted paths (``Metadata.mast_obs_id``), ``$ne``, and ``_id`` ObjectId lookups.
Deliberately minimal — extend only when the repository grows a new query.
"""

from typing import Any


def _matches(doc: dict, query: dict) -> bool:
    for key, expected in query.items():
        value: Any = doc
        for part in key.split("."):
            value = value.get(part) if isinstance(value, dict) else None
        if isinstance(expected, dict):
            if "$ne" in expected:
                if value == expected["$ne"]:
                    return False
            else:  # unsupported operator — fail loudly, not silently
                raise NotImplementedError(f"FakeCollection: operator in {expected}")
        elif value != expected:
            return False
    return True


class _FakeCursor:
    def __init__(self, docs: list[dict]):
        self._docs = docs

    async def to_list(self, length=None):
        return self._docs if length is None else self._docs[:length]

    def __aiter__(self):
        self._it = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration from None


class FakeCollection:
    def __init__(self, docs: list[dict]):
        self.docs = docs

    def find(self, query: dict, projection: dict | None = None) -> _FakeCursor:
        found = [d for d in self.docs if _matches(d, query)]
        if projection:
            keep = {k for k, v in projection.items() if v} | {"_id"}
            found = [{k: v for k, v in d.items() if k in keep} for d in found]
        return _FakeCursor(found)

    async def find_one(self, query: dict, projection: dict | None = None) -> dict | None:
        docs = await self.find(query, projection).to_list()
        return docs[0] if docs else None
