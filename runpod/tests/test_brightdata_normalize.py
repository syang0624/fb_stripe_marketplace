from runpod.lib.brightdata import normalize_listing, normalize_listings


def test_normalizes_flat_brightdata_record():
    raw = {
        "url": "https://fb.com/marketplace/item/1",
        "name": "iPhone 13 128GB",
        "final_price": 380,
        "initial_price": 420,
        "currency": "USD",
        "condition": "Used - Good",
        "description": "small scratch",
        "seller": {"name": "Alex M."},
        "location": "San Francisco, CA",
        "images": ["https://img/1.jpg", "https://img/2.jpg"],
    }
    listing = normalize_listing(raw)
    assert listing.title == "iPhone 13 128GB"
    assert listing.price == 380.0          # prefers final_price
    assert listing.currency == "USD"
    assert listing.seller == "Alex M."     # object -> name
    assert listing.images == ["https://img/1.jpg", "https://img/2.jpg"]
    assert listing.raw == raw              # original preserved


def test_price_falls_back_and_handles_strings():
    listing = normalize_listing({"url": "u", "title": "t", "price": "$1,200"})
    assert listing.price == 1200.0


def test_seller_string_and_photos_objects():
    listing = normalize_listing({
        "url": "u", "title": "t", "seller_name": "Pat",
        "images": [{"url": "https://a.jpg"}, "https://b.jpg"],
    })
    assert listing.seller == "Pat"
    assert listing.images == ["https://a.jpg", "https://b.jpg"]


def test_normalize_listings_maps_all():
    out = normalize_listings([{"url": "u1", "title": "a"}, {"url": "u2", "title": "b"}])
    assert [l.title for l in out] == ["a", "b"]


def test_location_dict_uses_city_state():
    listing = normalize_listing({"url": "u", "title": "t", "location": {"city": "San Francisco", "state": "CA"}})
    assert listing.location == "San Francisco, CA"


def test_location_coords_dict_returns_none():
    listing = normalize_listing({"url": "u", "title": "t", "location": {"latitude": 37.7, "longitude": -122.4}})
    assert listing.location is None


def test_location_reverse_geocode_city_state():
    listing = normalize_listing({"url": "u", "title": "t", "location": {"reverse_geocode": {"city": "Oakland", "state": "CA"}}})
    assert listing.location == "Oakland, CA"


def test_location_text_wrapper_preferred():
    listing = normalize_listing({"url": "u", "title": "t", "location_text": {"text": "San Jose, CA"}, "location": {"latitude": 1.0, "longitude": 2.0}})
    assert listing.location == "San Jose, CA"
