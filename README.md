# Detector CV

App web (PWA) para detectoristas de la Comunitat Valenciana: playas protegidas, normativa y qué hacer con los hallazgos.

## Cómo publicarla gratis (5 minutos)

**Opción A: Netlify Drop (la más fácil)**
1. Descomprime el zip.
2. Entra en https://app.netlify.com/drop (crea una cuenta gratuita).
3. Arrastra la carpeta `detectoristas-cv` a la página.
4. Te da una dirección tipo `https://nombre.netlify.app`. Puedes cambiar el nombre en *Site settings*.

**Opción B: GitHub Pages**
1. Crea un repositorio público en GitHub y sube el contenido de la carpeta.
2. En *Settings → Pages*, elige la rama `main` y la carpeta raíz.

Tiene que servirse por **https**: sin https el móvil no deja usar el GPS ni instalar la app.

## Instalar en el móvil
Abre la dirección en el móvil. En Android: menú ⋮ → *Instalar aplicación*. En iPhone: Compartir → *Añadir a pantalla de inicio*.
La primera vez hay que abrirla con conexión. Después funciona sin cobertura: las zonas, la normativa y los mapas de las zonas ya vistas quedan guardados.

## Contenido
- `data/zonas.json`: 57 zonas protegidas extraídas de los 49 mapas oficiales (GeoPDF, ETRS89 UTM 30N), con su franja de 100 m, y las 4 islas protegidas.
- `mapas/`: los 49 mapas oficiales en imagen.
- `docs/`: la circular de la DG de Cultura y Patrimonio (15/03/2021).
- Mapa base: IGN (mapa y ortofoto PNOA) u OpenStreetMap.

## Actualizar
Si la Generalitat cambia el listado, hay que regenerar `data/zonas.json` y subir de nuevo la carpeta. Cambia `const V = 'v1'` en `sw.js` (por ejemplo, a `'v2'`) para que los móviles descarguen la versión nueva.
