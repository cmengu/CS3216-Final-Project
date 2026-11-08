from read.text_recovery import recover_missing_text


def test_recovers_picture_text_and_deduplicates_repeated_source():
    md = 'Invoice CI14269394\n<!-- image -->'
    text = 'Raspberry Pi 4\n2 S$299.36 S$598.72\nTotal: S$605.06'
    result, missing = recover_missing_text(md, [text, text])
    assert len(missing) == 3
    assert result.count('S$605.06') == 1
    assert '<!-- image -->' in result


def test_table_separators_whitespace_and_unicode_do_not_duplicate_text():
    md = '| Raspberry Pi | 2 | S$299.36 | S$598.72 |'
    result, missing = recover_missing_text(md, ['Raspberry\u00a0Pi  2 S$299.36 S$598.72'])
    assert result == md
    assert missing == []


def test_completeness_check_preserves_missing_amount_and_code():
    result, missing = recover_missing_text('Order 544299\nTotal: S$598.72', [
        'Order 544299\nModel: CK-PI4-8G-BS2UK\nTotal: S$605.06'])
    assert missing == ['Model: CK-PI4-8G-BS2UK', 'Total: S$605.06']
    assert 'S$605.06' in result


def test_empty_or_already_complete_source_is_unchanged():
    assert recover_missing_text('Invoice', ['', 'Invoice']) == ('Invoice', [])


def test_picture_child_text_keeps_its_original_coordinates():
    from types import SimpleNamespace

    from read.reader import document_blocks

    bbox = SimpleNamespace(model_dump=lambda **_: {
        'l': 10, 't': 20, 'r': 110, 'b': 40, 'coord_origin': 'TOPLEFT'})
    child = SimpleNamespace(label='text', text='CK-PI4-8G-BS2UK', self_ref='#/texts/1',
                            prov=[SimpleNamespace(page_no=1, bbox=bbox)])

    def items(*, traverse_pictures=False):
        return [(child, 1)] if traverse_pictures else []

    doc = SimpleNamespace(iterate_items=items,
                          pages={1: SimpleNamespace(size=SimpleNamespace(width=595, height=842))})
    blocks = document_blocks(doc)
    assert blocks[0].text == 'CK-PI4-8G-BS2UK'
    assert blocks[0].locations[0].bbox['l'] == 10
    md, _ = recover_missing_text('<!-- image -->', [b.text for b in blocks])
    assert 'CK-PI4-8G-BS2UK' in md
