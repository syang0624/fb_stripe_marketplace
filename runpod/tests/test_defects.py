from runpod.lib.defects import build_defect_prompt, parse_defect_response


def test_prompt_mentions_iphone_and_json():
    p = build_defect_prompt()
    assert "iPhone" in p
    assert "json" in p.lower()
    assert "condition_grade" in p


def test_parse_clean_json():
    text = '{"defects": [{"type": "crack", "component": "screen", "severity": "severe", "confidence": 0.92, "note": "spiderweb crack"}], "condition_grade": "poor", "negotiation_summary": "screen cracked"}'
    r = parse_defect_response(text, "http://img/1")
    assert r.image_url == "http://img/1"
    assert r.condition_grade == "poor"
    assert r.defects[0].component == "screen"
    assert r.defects[0].severity == "severe"
    assert r.error is None


def test_parse_json_embedded_in_markdown_fence():
    text = 'Sure!\n```json\n{"defects": [], "condition_grade": "excellent", "negotiation_summary": "no visible defects"}\n```'
    r = parse_defect_response(text, "http://img/2")
    assert r.defects == []
    assert r.condition_grade == "excellent"
    assert r.error is None


def test_parse_unparseable_sets_error_and_preserves_text():
    r = parse_defect_response("the phone looks a bit scratched", "http://img/3")
    assert r.error == "unparseable"
    assert "scratched" in r.negotiation_summary


def test_parse_fenced_json_with_nested_defects():
    text = (
        '```json\n'
        '{"defects": [{"type": "scratch", "component": "back", "severity": "minor", "confidence": 0.4, "note": "light scratch"}, '
        '{"type": "dent", "component": "corner", "severity": "moderate", "confidence": 0.7, "note": ""}], '
        '"condition_grade": "fair", "negotiation_summary": "minor wear"}\n'
        '```'
    )
    r = parse_defect_response(text, "http://img/n")
    assert r.error is None
    assert len(r.defects) == 2
    assert r.defects[1].component == "corner"
    assert r.condition_grade == "fair"


def test_invalid_severity_defaults_to_minor():
    text = '{"defects": [{"type": "x", "component": "y", "severity": "catastrophic", "confidence": 0.5}], "condition_grade": "fair", "negotiation_summary": ""}'
    r = parse_defect_response(text, "i")
    assert r.defects[0].severity == "minor"


def test_invalid_confidence_defaults_to_zero():
    text = '{"defects": [{"type": "x", "component": "y", "severity": "minor", "confidence": "high"}], "condition_grade": "fair", "negotiation_summary": ""}'
    r = parse_defect_response(text, "i")
    assert r.defects[0].confidence == 0.0


def test_non_dict_defect_entry_skipped():
    text = '{"defects": ["not-an-object", {"type": "x", "component": "y", "severity": "minor", "confidence": 0.5}], "condition_grade": "good", "negotiation_summary": ""}'
    r = parse_defect_response(text, "i")
    assert len(r.defects) == 1


def test_confidence_clamped_to_unit_interval():
    text = '{"defects": [{"type": "x", "component": "y", "severity": "minor", "confidence": 5}], "condition_grade": "fair", "negotiation_summary": ""}'
    r = parse_defect_response(text, "i")
    assert r.defects[0].confidence == 1.0
