import os
import pytest


def pytest_addoption(parser):
    parser.addoption("--network", action="store_true", help="Tests mit swisstopo-Download ausführen")


def pytest_configure(config):
    config.addinivalue_line("markers", "network: braucht Zugriff auf data.geo.admin.ch")


def pytest_collection_modifyitems(config, items):
    if config.getoption("--network"):
        return
    skip = pytest.mark.skip(reason="nur mit --network")
    for it in items:
        if "network" in it.keywords:
            it.add_marker(skip)


@pytest.fixture(scope="session")
def cache_dir():
    return os.environ.get("SCHATTEN_CACHE", os.path.expanduser("~/.cache/schatten/swissalti3d"))
