(function exposeAddressLoader(global) {
  const citiesUrl = 'data/address/__CITIES_FILE__';
  let citiesPromise = null;
  const districtCache = new Map();

  function normalizeTurkish(value) {
    return String(value || '')
      .trim()
      .toLocaleLowerCase('tr-TR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ı/g, 'i');
  }

  function fetchJson(url) {
    return fetch(url, { headers: { Accept: 'application/json' } }).then((response) => {
      if (!response.ok) throw new Error('Adres verisi yüklenemedi. Lütfen bağlantınızı kontrol edip tekrar deneyin.');
      return response.json();
    });
  }

  function loadCities() {
    if (!citiesPromise) citiesPromise = fetchJson(citiesUrl);
    return citiesPromise;
  }

  async function findCity(value) {
    const normalized = normalizeTurkish(value);
    const cities = await loadCities();
    return cities.find((city) => String(city.id) === String(value) || normalizeTurkish(city.name) === normalized) || null;
  }

  async function loadDistricts(cityValue) {
    const city = await findCity(cityValue);
    if (!city) return [];
    if (!districtCache.has(city.id)) districtCache.set(city.id, fetchJson(city.districtsPath));
    return districtCache.get(city.id);
  }

  async function searchCities(query) {
    const normalized = normalizeTurkish(query);
    const cities = await loadCities();
    return normalized ? cities.filter((city) => normalizeTurkish(city.name).includes(normalized)) : cities;
  }

  async function searchDistricts(cityValue, query) {
    const normalized = normalizeTurkish(query);
    const districts = await loadDistricts(cityValue);
    return normalized ? districts.filter((district) => normalizeTurkish(district.name).includes(normalized)) : districts;
  }

  global.SuveraAddressData = { findCity, loadCities, loadDistricts, normalizeTurkish, searchCities, searchDistricts };
})(window);
