# ☀️ Clima en Tiempo Real

Aplicación **multiplataforma** (PWA) para consultar el clima en tiempo real. Funciona en el navegador y se puede **instalar como app** en Android, iOS, Windows, macOS y Linux. Consume únicamente **servicios gratuitos que no requieren API key**.

## Funcionalidades

- 📍 Clima de tu ubicación actual (geolocalización)
- 🔎 Búsqueda de cualquier ciudad del mundo con autocompletado
- 🌡️ Condiciones actuales: temperatura, sensación térmica, humedad, viento y ráfagas, presión, nubosidad, precipitación, índice UV, amanecer y atardecer
- 🌫️ Calidad del aire (índice europeo AQI y PM2.5)
- 📈 Gráfico interactivo de temperatura por hora (24 h)
- ⏱️ Pronóstico por hora (24 h) y de 7 días
- 🔄 Actualización automática cada 10 minutos y al volver a la app
- ⭐ Ciudades favoritas
- 🌡️ Cambio entre °C / °F
- 📴 Funciona sin conexión mostrando los últimos datos descargados
- 🌗 Fondo que cambia según sea de día o de noche en el lugar consultado

## Servicios utilizados (gratuitos)

| Servicio | Uso |
|---|---|
| [Open-Meteo Forecast API](https://open-meteo.com/en/docs) | Clima actual y pronósticos |
| [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) | Búsqueda de ciudades |
| [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api) | Calidad del aire |
| [Nominatim (OpenStreetMap)](https://nominatim.org/) | Nombre de la ciudad a partir de tu ubicación |

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
```

## Licencia

MIT. Datos meteorológicos de [Open-Meteo.com](https://open-meteo.com/) bajo licencia CC BY 4.0.
