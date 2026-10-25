const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

async function main() {
  const assets = path.resolve(__dirname, "..", "assets");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 256, height: 256 },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<body style="margin:0;background:transparent">${fs.readFileSync(path.join(assets, "app-icon.svg"), "utf8")}</body>`,
    );
    const png = await page.locator("svg").screenshot({ omitBackground: true });
    fs.writeFileSync(path.join(assets, "app-icon.png"), png);
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(png.length, 14);
    header.writeUInt32LE(22, 18);
    fs.writeFileSync(
      path.join(assets, "app-icon.ico"),
      Buffer.concat([header, png]),
    );
    await page.locator("svg").evaluate((svg) => {
      svg.setAttribute("width", "32");
      svg.setAttribute("height", "32");
    });
    await page
      .locator("svg")
      .screenshot({
        path: path.join(assets, "tray.png"),
        omitBackground: true,
      });
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
