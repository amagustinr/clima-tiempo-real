# ☀️ Clima en Tiempo Real

Aplicación **multiplataforma** (PWA) para consultar el clima en tiempo real. Funciona en el navegador y se puede **instalar como app** en Android, iOS, Windows, macOS y Linux. Consume únicamente **servicios gratuitos que no requieren API key**.

## Funcionalidades

Diseño oscuro tipo panel meteorológico, inspirado en los portales de clima más populares:

- 📍 Clima de tu ubicación actual (geolocalización) y búsqueda de cualquier ciudad con autocompletado
- ⭐ Barra de accesos rápidos con la temperatura actual de tus ciudades guardadas
- 🌡️ **El tiempo actual**: temperatura, sensación térmica, resumen del día, viento, humedad, visibilidad, presión y punto de rocío
- 🗺️ **Mapa con radar de lluvia** animado
- 📈 **Por hora**: gráfico interactivo con pestañas (información general, precipitación, viento, calidad del aire, humedad, nubosidad, presión y UV), selector de día (ayer + 7 días), amanecer/atardecer y franja de probabilidad de lluvia
- 🧩 **Detalles del tiempo**: 12 tarjetas visuales (temperatura, sensación térmica, nubosidad, precipitaciones, brújula de viento, humedad, índice UV, calidad del aire, visibilidad, presión, sol y fase lunar)
- 🔄 Actualización automática cada 10 minutos y al volver a la app
- 🌡️ Cambio entre °C / °F
- 📴 Funciona sin conexión mostrando los últimos datos descargados

## Servicios utilizados (gratuitos)

| Servicio | Uso |
|---|---|
| [Open-Meteo Forecast API](https://open-meteo.com/en/docs) | Clima actual y pronósticos |
| [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) | Búsqueda de ciudades |
| [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api) | Calidad del aire |
| [Nominatim (OpenStreetMap)](https://nominatim.org/) | Nombre de la ciudad a partir de tu ubicación |
| [RainViewer](https://www.rainviewer.com/api.html) | Radar de lluvia |
| [OpenStreetMap](https://www.openstreetmap.org/) + [Leaflet](https://leafletjs.com/) | Mapa |

Íconos meteorológicos animados de [Bas Milius](https://github.com/basmilius/weather-icons) (MIT).

## Uso

### En línea
Abre la versión publicada en GitHub Pages: `https://<tu-usuario>.github.io/clima-tiempo-real/`

### Instalar como app
- **Android (Chrome):** menú ⋮ → *Instalar aplicación*
- **iPhone/iPad (Safari):** botón Compartir → *Agregar a pantalla de inicio*
- **Windows/macOS/Linux (Chrome/Edge):** ícono de instalar en la barra de direcciones

### Local
No requiere compilación. Sirve la carpeta con cualquier servidor estático:

```bash
npx serve .
# o
python -m http.server 8080
```

> La geolocalización y el service worker requieren `https` o `localhost`.

## Estructura

```
index.html            Interfaz
styles.css            Estilos (responsive)
app.js                Lógica y consumo de las APIs
sw.js                 Service worker (modo sin conexión)
manifest.webmanifest  Manifiesto PWA
icons/                Íconos de la app
icons/wx/             Íconos meteorológicos (MIT, Bas Milius)
```

## Licencia

MIT. Datos meteorológicos de [Open-Meteo.com](https://open-meteo.com/) bajo licencia CC BY 4.0.
