// 「アニ速」をドット（LED 表示板ふう）のアイコンにする。上段「アニ」・下段「速」。
// 文字はフォントから起こすと崩れるので、ドットを手で置いている（# が点く）。
// 使い方: node scripts/make-favicon.mjs → site/favicon.svg・favicon-48.png・apple-touch-icon.png を作り直す
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || join(ROOT, "site");

const A = `
##############
.............#
............#.
.....#.....#..
.....#....#...
.....#..##....
.....#........
.....#........
....#.........
....#.........
...#..........
..#...........
.#............
`;
const NI = `
..............
..............
..##########..
..............
..............
..............
..............
..............
..............
..............
##############
`;
const SOKU = `
.#........#.....
..#.#########...
..........#.....
###....#######..
..#....#..#..#..
..#....#######..
..#......###....
..#.....#.#.#...
..#....#..#..#..
..#...#...#...#.
.#.#............
#...############
`;

const GRID = 32;
const lit = new Map();
function place(bitmap, x0, y0, color) {
  bitmap
    .trim()
    .split("\n")
    .forEach((line, y) => [...line].forEach((c, x) => c === "#" && lit.set(`${x0 + x},${y0 + y}`, color)));
}
place(A, 1, 2, "#ff4f86");
place(NI, 17, 2, "#ff4f86");
place(SOKU, 8, 18, "#ffd23f");

// 点いているドットは色ごとに 1 本の path にまとめる（円を 1 つずつ書くとファイルが重くなるため）
const R = 0.47;
const byColor = new Map();
for (const [k, color] of lit) {
  const [x, y] = k.split(",").map(Number);
  if (!byColor.has(color)) byColor.set(color, "");
  byColor.set(color, byColor.get(color) + `M${x + 0.5 - R} ${y + 0.5}a${R} ${R} 0 1 0 ${R * 2} 0a${R} ${R} 0 1 0 ${-R * 2} 0`);
}
const paths = [...byColor].map(([color, d]) => `<path fill="${color}" d="${d}"/>`).join("");
// 消えているドットは繰り返し模様で敷く。角丸の外にはみ出さないよう、角丸の形で切り抜く
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}"><defs><clipPath id="c"><rect width="${GRID}" height="${GRID}" rx="6"/></clipPath><pattern id="d" width="1" height="1" patternUnits="userSpaceOnUse"><circle cx=".5" cy=".5" r=".28" fill="#222742"/></pattern></defs><g clip-path="url(#c)"><rect width="${GRID}" height="${GRID}" fill="#161a31"/><rect width="${GRID}" height="${GRID}" fill="url(#d)"/>${paths}</g></svg>\n`;
await writeFile(`${OUT}/favicon.svg`, svg);
const sizes = [["favicon-48.png", 48], ["apple-touch-icon.png", 180]];
if (process.argv[3] === "preview") sizes.push(["preview-512.png", 512], ["preview-32.png", 32], ["preview-16.png", 16]);
for (const [name, size] of sizes) await sharp(Buffer.from(svg), { density: 1200 }).resize(size, size).png().toFile(`${OUT}/${name}`);
console.log("ok", lit.size);
