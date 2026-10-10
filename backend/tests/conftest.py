import pytest


def pytest_addoption(parser):
    parser.addoption("--run-docling", action="store_true", help="Run model-backed PDF/OCR tests")


def pytest_collection_modifyitems(config, items):
    if not config.getoption("--run-docling"):
        for item in items:
            if "docling" in item.keywords:
                item.add_marker(
                    pytest.mark.skip(reason="Pass --run-docling to download/run models")
                )
