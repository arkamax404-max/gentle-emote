/** One-pixel external silhouette outline; never outlines enclosed holes or labels. */
export function drawDisplayOutline(data: Uint8Array, occupied: Uint8Array, color: readonly number[]): void {
  const width = 64, height = 41; // Avatar viewport plus one bottom outline row.
  const exterior = new Uint8Array(width * height);
  const queue = new Uint16Array(width * height);
  let head = 0, tail = 0;
  const add = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const index = y * width + x;
    if (occupied[index] || exterior[index]) return;
    exterior[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x++) { add(x, 0); add(x, height - 1); }
  for (let y = 0; y < height; y++) { add(0, y); add(width - 1, y); }
  while (head < tail) {
    const index = queue[head++]!, x = index % width, y = Math.floor(index / width);
    add(x - 1, y); add(x + 1, y); add(x, y - 1); add(x, y + 1);
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    if (!exterior[index]) continue;
    let adjacent = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && occupied[ny * width + nx]) adjacent = true;
    }
    if (adjacent) data.set([color[0]!, color[1]!, color[2]!, 255], index * 4);
  }
}
