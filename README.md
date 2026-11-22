# BOX Integration Systems · Eurocontainer · E=Gedesel

Página de presentación para feria. Sitio estático (sin servidor, sin compilación): se publica tal cual en GitHub Pages.

**Dirección definitiva:** https://eurocontainer-gedesel-boxis.github.io/qrcard/

## Estructura

```
index.html            Contenido de la página
css/styles.css        Estilos (una sola hoja, sin parches superpuestos)
js/ui.js              Interfaz: aparición al hacer scroll, inclinación 3D de tarjetas, navegación, vCards
js/viewer.js          Visor 3D de la unidad (three.js)
js/free-orbit.js      Controlador de cámara con órbita libre de 360° en todas las direcciones
assets/3d/            Modelo GLB propio (boxis-modelo.glb) y logotipo de Eurocontainer para la chapa
assets/logos/         Logotipos de BOX, Eurocontainer y E=Gedesel: `*-color.png` (a color, para fondo oscuro) y `*-original.png` (colores tal cual, para fondo claro)
assets/img/           Fotografías de la unidad, del belly tank y vista aérea de las instalaciones de Remolinos
assets/video/         Vídeo del montaje del contenedor y del belly tank (H.264, con audio): versión ligera 848×478 para la vista normal, versión 4K nativa 3840×2160 (archivo original del propietario del sitio) para pantalla completa, y el póster
vendor/three/         three.js (r188dev) incluido en local (la página funciona sin CDN ni conexión a otros servidores)
```

## Visor 3D

Trabaja directamente sobre `assets/3d/boxis-modelo.glb`. Para cambiar el modelo basta con sustituir ese archivo por otro con los mismos nombres de material (`estructura-container`, `torre-extraccion`, `estructura-belly-tank`, `motor`, `ventilador-del-motor`, `aspas-ventilador`, `silenciador-escape`, `aislamiento-tubo-escape`, `cuadro-de-potencia`, `cuadros-de-control`, `filtros-de-aire`).

En tiempo de ejecución el visor añade lo que el GLB no trae: normales con aristas vivas, materiales físicos y suciedad por posición, tejado corrugado (el modelo original está abierto por arriba), sillines del silenciador, iluminación con sombras y los logotipos originales de Eurocontainer proyectados sobre la chapa corrugada.

Tres vistas:
1. **Exterior completo**: unidad cerrada con logotipos. Se abre de perfil (vista lateral a 90°) y gira sola 360°; el encuadre se recalcula en cada ángulo para que la base nunca quede cortada.
2. **Interior del contenedor**: corte animado (tejado, torre y lateral retirados) con motor, radiador, cuadros y filtros.
3. **Interior del belly tank**: solo se muestra el depósito (el contenedor se oculta) y queda abierto por un lateral.

Interacción: arrastrar para orbitar sin límites (360° en horizontal y en vertical, también desde abajo; `js/free-orbit.js`), rueda para acercar (tras pulsar en el visor, para no bloquear el scroll de la página), pulsar un componente para aislarlo y encuadrarlo, botones y teclado (flechas, + / −, Esc, Inicio, 1 / 2 / 3). En pantallas táctiles, un dedo gira y dos dedos acercan y orbitan. Cada pieza se identifica por color-ID en GPU, por lo que la selección es exacta.

Los parámetros editables (vistas, cortes, textos de cada pieza, posición y tamaño de los logotipos) están al principio de `js/viewer.js` (`PARTS`, `MODES`, `LOOKS`, `DECALS`).

## Tipografías y logotipos
- Titulares e interfaz: Barlow Condensed, Inter y Manrope, cargadas desde Google Fonts con tipografías del sistema como alternativa.
- Los logotipos proceden de los archivos facilitados, sin redibujar: se reescalan con separación limpia de color y transparencia (sin halos). Sobre el fondo oscuro se usa la versión a color (símbolo con sus colores de marca y rotulación clara) y sobre la chapa del modelo 3D la versión original con sus colores. En el logotipo de Eurocontainer la geometría procede del archivo de mayor resolución alineado con el logotipo facilitado.

## Galería
Cuatro elementos en una fila (unidad, belly tank, vídeo del montaje, instalaciones). El vídeo solo carga sus metadatos hasta que se pulsa reproducir. Al pasar a pantalla completa cambia automáticamente a la versión 4K nativa (`data-hires` en `index.html`, lógica en `js/ui.js`); con «ahorro de datos» activado se mantiene la versión ligera. Ambas versiones llevan audio. El archivo 4K es el vídeo original del propietario del sitio (sin reescalar); la versión ligera es un recorte a 848×478 del mismo origen para que la vista normal no tenga que descargar el archivo grande. En tablet pasa a 2×2 y en móvil a una columna.

## Contactos
Las tres tarjetas del equipo de BOX Integration Systems tienen el mismo formato (teléfono, correo, horario y sede), descargan su vCard desde `js/ui.js` (objeto `team`) y abren el correo con `mailto:`.
