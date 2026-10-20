import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from api.app import create_app
from api.master_import import normalize, read_tables


@pytest.fixture(autouse=True)
def mapping_stub(monkeypatch):
    # Parser/persistence tests avoid network; LLM behavior has its own test suite.
    import re

    from api.master_import import FIELDS, REQUIRED
    from api.master_mapping import Column, Layout, Layouts

    def fake(sheets):
        layouts = []
        for index, sheet in enumerate(sheets):

            def mapping(row):
                headings = [re.sub(r"[^a-z0-9]+", " ", v.lower()).strip() for v in row]
                result = {}
                for field, aliases in FIELDS.items():
                    matches = [i for i, heading in enumerate(headings) if heading in aliases]
                    if len(matches) == 1:
                        result[field] = matches[0]
                return result

            header = max(
                range(len(sheet["rows"])),
                key=lambda i: sum(k in mapping(sheet["rows"][i]) for k in REQUIRED),
            )
            layouts.append(
                Layout(
                    sheet=index,
                    header=header,
                    columns=[
                        Column(field=k, column=v) for k, v in mapping(sheet["rows"][header]).items()
                    ],
                    note="",
                )
            )
        return Layouts(sheets=layouts)

    monkeypatch.setattr("api.master_import.suggest_layouts", fake)


CSV = b"Product Name,Unit Price,Qty\nBolt,1.20,10\nNut,0,0\n"


def workbook():
    book = Workbook()
    sheet = book.active
    sheet.title = "Prices"
    sheet.append(["Supplier catalogue"])
    sheet.append(["Product Name", "Unit Price", "Qty"])
    sheet.append(["Bolt", 1.2, 10])
    output = io.BytesIO()
    book.save(output)
    return output.getvalue()


@pytest.mark.parametrize("filename,data", [("prices.csv", CSV), ("prices.xlsx", workbook())])
def test_normalization(filename, data):
    tables = read_tables(filename, data)
    result = normalize(tables)
    assert result[0]["name"] == "Bolt"
    assert float(result[0]["price"]) == 1.2
    assert result[0]["quantity"] == "10"
    assert result[0]["supplier"] is None
    assert result[0]["discount"] is None
    assert result[0]["unit"] is None


def test_arbitrary_mapping_and_multiple_sheets():
    tables = {
        "Notes": [["Notes"]],
        "Catalogue": [["Title"], ["Material", "Agreed", "Count"], ["Bolt", "12.25", "4"]],
    }
    with pytest.raises(ValueError, match="Select the worksheet"):
        normalize(tables)
    rows = normalize(tables, "Catalogue", 1, {"name": 0, "price": 1, "quantity": 2})
    assert rows[0]["name"] == "Bolt"
    assert rows[0]["quantity"] == "4"


@pytest.mark.parametrize(
    "row",
    ["Bolt,,2", "Bolt,2,", ",2,2", "Bolt,-2,2", "Bolt,NaN,2", "Bolt,2,Infinity", "Bolt,=A1,2"],
)
def test_invalid_required_values(row):
    with pytest.raises(ValueError, match="Row 2"):
        normalize(read_tables("prices.csv", ("name,price,quantity\n" + row).encode()))


def test_missing_and_ambiguous_columns():
    row = normalize(read_tables("a.csv", b"name,price\nBolt,2\n"))[0]
    assert row["quantity"] is None
    assert row["totalPrice"] == "2"
    with pytest.raises(ValueError, match="price"):
        normalize(read_tables("a.csv", b"name,price,unit price,quantity\nBolt,2,3,4\n"))


def test_bom_delimiter_quotes():
    rows = normalize(
        read_tables("a.csv", '\ufeffName;Price;Quantity\r\n"Bolt; large";1.20;5\r\n'.encode())
    )
    assert rows[0]["name"] == "Bolt; large"


def test_persistence_and_rejected_replacement(tmp_path):
    app = create_app(storage_dir=tmp_path)
    with TestClient(app) as client:
        assert client.get("/master-list").json() is None
        result = client.post("/master-list/preview", files={"file": ("prices.xlsx", workbook())})
        assert result.status_code == 200
        assert result.json()["sheets"][0]["header"] == 1
        assert client.get("/master-list").json() is None
        uploaded = client.post("/master-list", files={"file": ("prices.csv", CSV)})
        assert uploaded.status_code == 201
        first = uploaded.json()
        assert len(first["items"]) == 2
        assert (
            client.put(
                "/master-list", files={"file": ("bad.csv", b"name,price\nBolt,invalid")}
            ).status_code
            == 422
        )
        assert client.get("/master-list").json() == first
        assert client.post("/master-list", files={"file": ("prices.csv", CSV)}).status_code == 409
        replaced = client.put("/master-list", files={"file": ("prices.xlsx", workbook())})
        assert replaced.status_code == 200
        assert len(client.get("/master-list/events").json()) == 2
        assert client.post("/master-list", files={"file": ("bad.pdf", b"bad")}).status_code == 415
        assert (
            client.post("/master-list/preview", files={"file": ("bad.xlsx", b"bad")}).status_code
            == 422
        )
    with TestClient(create_app(storage_dir=tmp_path)) as client:
        assert client.get("/master-list").json() == replaced.json()
        assert client.get("/master-list/events").json()[0]["kind"] == "replaced"


def test_limit_and_mapping_validation(tmp_path):
    with TestClient(create_app(storage_dir=tmp_path)) as client:
        assert (
            client.post(
                "/master-list", files={"file": ("big.csv", b"x" * (5 * 1024 * 1024 + 1))}
            ).status_code
            == 413
        )
        for options in [
            "[]",
            '{"mapping": []}',
            '{"mapping": {"name": -1}}',
            '{"header": "a"}',
            '{"sheet": []}',
        ]:
            assert (
                client.post(
                    "/master-list", files={"file": ("prices.csv", CSV)}, data={"options": options}
                ).status_code
                == 422
            )


def test_legacy_excel():
    data = (Path(__file__).parent / "fixtures/master-list.xls").read_bytes()
    item = normalize(read_tables("prices.xls", data))[0]
    assert item["name"] == "Bolt"
    assert float(item["price"]) == 1.2
    assert float(item["quantity"]) == 10


def test_api_custom_columns(tmp_path):
    with TestClient(create_app(storage_dir=tmp_path)) as client:
        result = client.post(
            "/master-list",
            files={"file": ("custom.csv", b"Heading\nLabel,Value,Count\nBolt,1.00,5\n")},
            data={
                "options": '{"sheet":"CSV","header":1,"mapping":{"name":0,"price":1,"quantity":2}}'
            },
        )
        assert result.status_code == 201
        assert result.json()["items"][0]["price"] == "1.00"


def test_omit_quantity_even_when_file_has_column():
    row = normalize(
        read_tables("a.csv", b"name,price,quantity\nService,12.50,\n"),
        "CSV",
        0,
        {"name": 0, "price": 1},
    )[0]
    assert row["quantity"] is None
    assert row["price"] == row["totalPrice"] == "12.50"


def test_total_price_with_quantity():
    row = normalize(read_tables("a.csv", b"name,price,quantity\nBolt,1.25,8\n"))[0]
    assert row["totalPrice"] == "10.00"
