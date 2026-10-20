(function () {
  "use strict";

  // Physical dimensions are written into the PDF, independently of print settings.
  const PAGE_WIDTH = 182;
  const PAGE_HEIGHT = 257;
  const SCALE = 12; // Approximately 305 dpi, including Japanese text.
  const LEFT = 21;
  const TOP = 29;
  const BOTTOM = 237;
  const WIDTHS = [10, 19, 14, 19, 25, 14, 39];
  const FONT = '"Yu Gothic", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif';
  const FONT_SIZE = 2.5;
  const LINE_HEIGHT = 3.5;
  const PADDING = 0.8;

  function wrapText(context, value, width) {
    const lines = [];
    for (const paragraph of String(value || "").split(/\r?\n/)) {
      let line = "";
      for (const char of paragraph) {
        if (line && context.measureText(line + char).width > width) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
      lines.push(line);
    }
    return lines;
  }

  async function createLedgerPdf(title, columns, rows) {
    if (document.fonts) await document.fonts.ready;
    const canvas = document.createElement("canvas");
    canvas.width = PAGE_WIDTH * SCALE;
    canvas.height = PAGE_HEIGHT * SCALE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.scale(SCALE, SCALE);
    context.font = `${FONT_SIZE}px ${FONT}`;

    const prepared = rows.map((row) => {
      const cells = columns.map(([key], index) => wrapText(context, row[key], WIDTHS[index] - 2 * PADDING));
      return { row, cells, lines: Math.max(...cells.map((cell) => cell.length)) };
    });
    const groups = [];
    for (const row of prepared) {
      if (String(row.row.date || "").trim() || !groups.length) groups.push([]);
      groups[groups.length - 1].push(row);
    }

    const images = [];
    let y;
    let pageNumber = 0;
    function drawRow(cells, height, header = false) {
      let x = LEFT;
      context.font = `${header ? "bold " : ""}${FONT_SIZE}px ${FONT}`;
      context.textBaseline = "top";
      context.lineWidth = 0.18;
      context.strokeStyle = "#000";
      cells.forEach((lines, index) => {
        const width = WIDTHS[index];
        if (header) {
          context.fillStyle = "#eeeeee";
          context.fillRect(x, y, width, height);
        }
        context.strokeRect(x, y, width, height);
        context.fillStyle = "#000";
        const align = header || index === 0 ? "center" : index === 2 || index === 5 ? "right" : "left";
        context.textAlign = align;
        const textX = align === "center" ? x + width / 2 : align === "right" ? x + width - PADDING : x + PADDING;
        lines.forEach((line, lineIndex) => context.fillText(line, textX, y + PADDING + lineIndex * LINE_HEIGHT));
        x += width;
      });
      y += height;
    }
    function startPage() {
      pageNumber += 1;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
      context.fillStyle = "#000";
      context.font = `bold 3.5px ${FONT}`;
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillText(title, PAGE_WIDTH / 2, 20);
      context.font = `2.3px ${FONT}`;
      context.textAlign = "right";
      context.fillText(String(pageNumber), LEFT + 140, 243);
      y = TOP;
      drawRow(columns.map(([, label]) => [label]), 5.5, true);
    }
    async function finishPage() {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.98));
      if (!blob) throw new Error("PDF image generation failed");
      images.push(new Uint8Array(await blob.arrayBuffer()));
    }
    startPage();
    const availableHeight = BOTTOM - y;
    for (const group of groups) {
      const groupHeight = group.reduce((sum, row) => sum + row.lines * LINE_HEIGHT + PADDING * 2, 0);
      // Keep split journal entries together when the group fits on a page.
      if (groupHeight <= availableHeight && y + groupHeight > BOTTOM) {
        await finishPage();
        startPage();
      }
      for (const row of group) {
        let offset = 0;
        while (offset < row.lines) {
          let capacity = Math.floor((BOTTOM - y - PADDING * 2) / LINE_HEIGHT);
          const remaining = row.lines - offset;
          if (capacity < 1 || (offset === 0 && remaining <= Math.floor((availableHeight - PADDING * 2) / LINE_HEIGHT) && remaining > capacity)) {
            await finishPage();
            startPage();
            capacity = Math.floor((BOTTOM - y - PADDING * 2) / LINE_HEIGHT);
          }
          const count = Math.min(capacity, remaining);
          drawRow(row.cells.map((cell) => cell.slice(offset, offset + count)), count * LINE_HEIGHT + PADDING * 2);
          offset += count;
        }
      }
    }
    await finishPage();
    canvas.width = canvas.height = 1;
    return encodePdf(images);
  }

  // A small image-only PDF writer: fonts and browser printing cannot change its geometry.
  function encodePdf(images) {
    const encoder = new TextEncoder();
    const chunks = [];
    const offsets = [0];
    let length = 0;
    function append(value) {
      const bytes = typeof value === "string" ? encoder.encode(value) : value;
      chunks.push(bytes);
      length += bytes.length;
    }
    function object(id, content) {
      offsets[id] = length;
      append(`${id} 0 obj\n${content}\nendobj\n`);
    }
    const width = (PAGE_WIDTH * 72 / 25.4).toFixed(6);
    const height = (PAGE_HEIGHT * 72 / 25.4).toFixed(6);
    append("%PDF-1.4\n");
    object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    object(2, `<< /Type /Pages /Count ${images.length} /Kids [${images.map((_, index) => `${3 + index * 3} 0 R`).join(" ")}] >>`);
    images.forEach((image, index) => {
      const id = 3 + index * 3;
      object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
      offsets[id + 1] = length;
      append(`${id + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${PAGE_WIDTH * SCALE} /Height ${PAGE_HEIGHT * SCALE} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`);
      append(image);
      append("\nendstream\nendobj\n");
      const commands = `q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`;
      object(id + 2, `<< /Length ${encoder.encode(commands).length} >>\nstream\n${commands}endstream`);
    });
    const xref = length;
    append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
    offsets.slice(1).forEach((offset) => append(`${String(offset).padStart(10, "0")} 00000 n \n`));
    append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(chunks, { type: "application/pdf" });
  }

  window.createLedgerPdf = createLedgerPdf;
})();
