import numpy as np

KM_PER_DEG = 111.195  # mean great-circle km per degree of latitude
EARTH_RADIUS_KM = 6371.0088


def haversine_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(a))


def to_km(lat0, lon0, lat, lon):
    """(east, north) displacement in km of (lat, lon) from (lat0, lon0), local tangent plane at lat0."""
    north = (lat - lat0) * KM_PER_DEG
    east = (lon - lon0) * KM_PER_DEG * np.cos(np.radians(lat0))
    return east, north


def from_km(lat0, lon0, east, north):
    lat = lat0 + north / KM_PER_DEG
    lon = lon0 + east / (KM_PER_DEG * np.cos(np.radians(lat0)))
    return lat, lon
