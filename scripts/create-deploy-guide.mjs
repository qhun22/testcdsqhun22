import { deflateRawSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const destination = resolve("docs/huong-dan-deploy-cloudflare.docx");
const paragraphs = [];
const xmlEscape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);

function addParagraph(text, style = "Normal", options = {}) {
  const parts = String(text).split("\n");
  const runs = parts.map((part, index) => `${index ? "<w:br/>" : ""}<w:r><w:rPr><w:lang w:val="vi-VN"/>${options.bold ? "<w:b/><w:color w:val=\"244636\"/>" : ""}</w:rPr><w:t xml:space="preserve">${xmlEscape(part)}</w:t></w:r>`).join("");
  paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="${style}"/>${options.shading ? `<w:shd w:fill="${options.shading}"/>` : ""}${options.keepNext ? "<w:keepNext/>" : ""}</w:pPr>${runs}</w:p>`);
}

function heading(text, level = 1) { addParagraph(text, `Heading${level}`, { keepNext: true }); }
function bullet(text) { addParagraph(text, "ListParagraph", { shading: "F3F6EF" }); }
function step(number, title, detail) {
  addParagraph(`${number}. ${title}`, "Heading2", { keepNext: true });
  addParagraph(detail);
}
function command(value) { addParagraph(value, "CodeBlock", { shading: "EEF1EA" }); }

addParagraph("HƯỚNG DẪN TRIỂN KHAI", "Title");
addParagraph("CHỢ NHÀ · CLOUDFLARE WORKERS + D1", "Subtitle");
addParagraph("Tài liệu này hướng dẫn cách đưa cửa hàng Chợ Nhà lên Cloudflare. Trang bán hàng được viết bằng HTML, CSS và JavaScript; Cloudflare Worker chạy phần máy chủ, còn Cloudflare D1 lưu sản phẩm, khách hàng và đơn hàng.");
addParagraph("Ngày cập nhật: 28/09/2026");
addParagraph("Ghi chú: tên dịch vụ, tên lệnh, đường dẫn tệp và tên biến được giữ nguyên để bạn có thể đối chiếu và nhập chính xác.", "Note");

heading("1. Thông tin cửa hàng đã đưa lên Cloudflare");
bullet("Trang cửa hàng: https://cho-nha-commerce.kirinhoang.workers.dev");
bullet("Trang quản trị: https://cho-nha-commerce.kirinhoang.workers.dev/admin.html");
bullet("Tên máy chủ Cloudflare Worker: cho-nha-commerce");
bullet("Tên cơ sở dữ liệu D1: cho-nha-db");
bullet("Mã cơ sở dữ liệu: 5839dbc5-0eaa-4a03-a152-7005f7b037d6");
bullet("Tên kết nối D1 trong Worker: DB; thư mục chứa tệp cập nhật dữ liệu: migrations/");
bullet("Các lệnh bên dưới cần chạy tại thư mục dự án có package.json và wrangler.jsonc.");

heading("2. Các phần của dự án");
bullet("apps/storefront/: giao diện cửa hàng gồm HTML, CSS và JavaScript; Worker gửi các tệp này đến trình duyệt.");
bullet("apps/api/src/index.js: phần máy chủ tiếp nhận yêu cầu từ cửa hàng và làm việc với D1.");
bullet("migrations/: các tệp SQL tạo bảng và thêm dữ liệu ban đầu. Tệp mới dùng để cập nhật cấu trúc D1.");
bullet("wrangler.jsonc: tệp cấu hình tên Worker, giao diện cửa hàng và kết nối D1.");
bullet("Đường dẫn /api/admin/* được bảo vệ bằng mã ADMIN_TOKEN. Không ghi mã bí mật vào mã nguồn hay tài liệu.");

heading("3. Cần chuẩn bị"); bullet("Máy Windows có PowerShell và Node.js phiên bản 20 trở lên.");
bullet("Tài khoản Cloudflare có quyền sử dụng Worker và D1; công cụ Wrangler đã đăng nhập vào tài khoản đó.");
bullet("Kết nối Internet để tải các gói cần thiết và gửi ứng dụng lên Cloudflare.");
bullet("Chỉ sử dụng mã D1 của cửa hàng Chợ Nhà, không dùng mã của dự án khác.");

heading("4. Chuẩn bị máy tính và tài khoản Cloudflare");
step(1, "Mở thư mục dự án", "Mở PowerShell tại thư mục C:\\Users\\Noah\\Documents\\CDS, nơi có tệp package.json.");
command("cd C:\\Users\\Noah\\Documents\\CDS");
step(2, "Cài các gói cần thiết", "Dùng npm.cmd thay cho npm để tránh lỗi chính sách PowerShell chặn tệp npm.ps1.");
command("npm.cmd install");
step(3, "Đăng nhập Cloudflare", "Nếu chưa đăng nhập, chạy lệnh rồi hoàn tất các bước xác nhận trong trình duyệt.");
command("npx.cmd wrangler login");
step(4, "Kiểm tra tài khoản", "Lệnh này cho biết Wrangler đang dùng tài khoản Cloudflare nào. Hãy kiểm tra đúng tài khoản trước khi tiếp tục.");
command("npx.cmd wrangler whoami");

heading("5. Nối Worker với cơ sở dữ liệu D1");
step(1, "Kiểm tra thông tin kết nối", "Mở wrangler.jsonc và xác nhận các giá trị bên dưới. DB là tên kết nối mà mã Worker sử dụng; database_id là mã của D1 trên tài khoản Cloudflare.");
command('"binding": "DB"\n"database_name": "cho-nha-db"\n"database_id": "5839dbc5-0eaa-4a03-a152-7005f7b037d6"\n"migrations_dir": "migrations"');
step(2, "Xem các D1 đang có", "Kiểm tra trước để không tạo thêm cơ sở dữ liệu trùng tên.");
command("npx.cmd wrangler d1 list");
step(3, "Tạo D1 nếu chưa có", "Chỉ chạy lệnh này nếu danh sách trên chưa có cho-nha-db. Sau khi tạo, chép database_id Wrangler cung cấp vào wrangler.jsonc và giữ nguyên tên kết nối DB.");
command("npx.cmd wrangler d1 create cho-nha-db");
step(4, "Tạo bảng trên D1 Cloudflare", "Lệnh có --remote sẽ thay đổi cơ sở dữ liệu đang chạy trên Cloudflare. Chạy khi đưa ứng dụng lên lần đầu hoặc khi dự án có tệp cập nhật D1 mới.");
command("npx.cmd wrangler d1 migrations apply cho-nha-db --remote");
step(5, "Kiểm tra bảng và dữ liệu", "Mở Cloudflare Dashboard, chọn D1 rồi mở mục Console của cho-nha-db. Các câu lệnh dưới đây chỉ xem dữ liệu, không sửa dữ liệu.");
command("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;\nSELECT COUNT(*) AS products FROM products;\nSELECT COUNT(*) AS categories FROM categories;");
addParagraph("Tệp migrations/0001_init.sql tạo các bảng và thêm sản phẩm mẫu. Không xóa hay sửa tệp cập nhật đã chạy trên cửa hàng thật.", "Note");

heading("6. Đặt mã bí mật cho trang quản trị");
step(1, "Đưa Worker lên lần đầu", "Cần tạo Worker trước thì mới thêm được mã bí mật vào Worker đó.");
command("npx.cmd wrangler deploy");
step(2, "Tạo mã ADMIN_TOKEN", "Chạy lệnh bên dưới. Khi thấy Enter a secret value, tự nhập một mã dài, khó đoán ngay trong PowerShell rồi nhấn Enter. Mã sẽ không hiện trên màn hình. Không gửi mã qua tin nhắn, không ghi vào tệp mã nguồn và không đưa vào kho Git.");
command("npx.cmd wrangler secret put ADMIN_TOKEN");
step(3, "Nếu Wrangler hỏi có tạo Worker mới không", "Chọn No nếu chưa đưa Worker lên. Sau đó chạy lệnh đưa Worker lên ở bước 1 rồi chạy lại lệnh tạo ADMIN_TOKEN.");
addParagraph("Nếu chưa đặt ADMIN_TOKEN, trang quản trị sẽ không truy cập được. Đây là biện pháp bảo vệ, không nên tắt.", "Warning");

heading("7. Kiểm tra và đưa cửa hàng lên Cloudflare");
step(1, "Kiểm tra các tệp JavaScript", "Chạy tại thư mục dự án. Các lệnh này tìm lỗi cú pháp và không sửa dữ liệu.");
command("node --check apps/api/src/index.js\nnode --check apps/storefront/store.js\nnode --check apps/storefront/admin.js");
step(2, "Gửi cửa hàng lên Cloudflare", "Wrangler đọc wrangler.jsonc, gửi phần máy chủ và các tệp giao diện lên, rồi nối Worker với D1.");
command("npx.cmd wrangler deploy");
step(3, "Lưu địa chỉ cửa hàng", "Cuối lệnh, Wrangler in ra địa chỉ trang web. Cửa hàng Chợ Nhà hiện ở https://cho-nha-commerce.kirinhoang.workers.dev.");

heading("8. Thử cửa hàng sau khi đưa lên");
bullet("Mở trang cửa hàng, thử xem sản phẩm, lọc theo danh mục, tìm kiếm và thêm món vào giỏ.");
bullet("Mở /api/health. Kết quả bình thường là {\"ok\":true}.");
bullet("Mở /api/categories và /api/products để xác nhận trang đọc được danh mục và sản phẩm từ D1.");
bullet("Mở /admin.html và nhập ADMIN_TOKEN. Màn hình tổng quan quản trị cần tải được.");
bullet("Nếu mở /api/admin/summary mà không gửi mã ADMIN_TOKEN, kết quả cần là HTTP 401 (không được phép truy cập).");
bullet("Chỉ đặt đơn thử khi chấp nhận tạo đơn thật trong D1 trên Cloudflare. Không dùng thông tin cá nhân của khách hàng thật để thử.");

heading("9. Cập nhật cửa hàng về sau");
step(1, "Thêm tệp cập nhật D1 mới", "Nếu cần đổi cấu trúc bảng, tạo tệp SQL số tiếp theo, ví dụ migrations/0002_add_field.sql. Không sửa tệp đã chạy trên cửa hàng thật.");
step(2, "Cập nhật D1 trên Cloudflare", "Đọc kỹ câu lệnh SQL và xác nhận đúng tên cơ sở dữ liệu trước khi chạy.");
command("npx.cmd wrangler d1 migrations apply cho-nha-db --remote");
step(3, "Đưa mã mới lên", "Sau khi cập nhật D1 thành công, gửi phiên bản mới của Worker và giao diện lên Cloudflare.");
command("npx.cmd wrangler deploy");
step(4, "Xem thông báo hoạt động", "Lệnh này hiển thị thông báo từ Worker đang chạy để hỗ trợ tìm lỗi.");
command("npx.cmd wrangler tail cho-nha-commerce");

heading("10. Xử lý một số lỗi thường gặp");
bullet("PowerShell chặn npm.ps1: dùng npm.cmd và npx.cmd như các ví dụ trong tài liệu này.");
bullet("Mã D1 không hợp lệ: kiểm tra database_id trong wrangler.jsonc, bảo đảm đó là mã của cho-nha-db trên đúng tài khoản Cloudflare.");
bullet("Báo không tìm thấy bảng: kiểm tra tên và mã D1, xác nhận kết nối DB rồi chạy lệnh cập nhật D1 với --remote.");
bullet("Trang quản trị báo 401: kiểm tra ADMIN_TOKEN đã được đặt cho Worker cho-nha-commerce và nhập đúng mã.");
bullet("Trang vẫn hiện giao diện cũ: chạy lại npx.cmd wrangler deploy rồi tải lại trang.");
bullet("Không chạy pnpm run build: dự án Chợ Nhà dùng JavaScript thuần, không dùng Next.js và không có bước tạo bản build riêng.");

heading("11. Ghi chú về thanh toán và bảo mật");
addParagraph("Hiện tại, cửa hàng chỉ ghi nhận khách chọn trả tiền khi nhận hàng hoặc chuyển khoản thủ công. Đơn hàng được tạo ở trạng thái chờ xác nhận; ứng dụng chưa thu tiền trực tuyến. Muốn kết nối ví điện tử hoặc ngân hàng cần bổ sung bước kiểm tra giao dịch ở máy chủ trước khi đánh dấu đơn là đã thanh toán.");
addParagraph("Giữ kín ADMIN_TOKEN: chỉ nhập mã trong PowerShell khi Wrangler yêu cầu. Không gửi mã qua tin nhắn, không ghi vào tài liệu, không chụp màn hình lúc mã đang được nhập và không đưa tệp chứa mã lên kho mã nguồn.", "Warning");

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/><w:cols w:space="720"/></w:sectPr></w:body></w:document>`;
const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="21"/><w:color w:val="26332C"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="280" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:rFonts w:ascii="Aptos Display" w:hAnsi="Aptos Display"/><w:b/><w:color w:val="345B47"/><w:sz w:val="38"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:rPr><w:b/><w:color w:val="D8734B"/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="345B47"/><w:sz w:val="27"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="70"/></w:pPr><w:rPr><w:b/><w:color w:val="26332C"/><w:sz w:val="23"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="240"/><w:spacing w:after="90"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="180" w:right="180"/><w:spacing w:before="50" w:after="150"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/><w:color w:val="26332C"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="180" w:right="180"/><w:spacing w:before="100" w:after="150"/></w:pPr><w:rPr><w:i/><w:color w:val="56634F"/><w:sz w:val="19"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Warning"><w:name w:val="Warning"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="180" w:right="180"/><w:spacing w:before="100" w:after="150"/></w:pPr><w:rPr><w:b/><w:color w:val="A64F37"/><w:sz w:val="19"/></w:rPr></w:style></w:styles>`;
const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
}
const crcTable = makeCrcTable();
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf8");
    const input = Buffer.from(content, "utf8");
    const compressed = deflateRawSync(input);
    const crc = crc32(input);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(input.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    localParts.push(header, nameBytes, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(input.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += header.length + nameBytes.length + compressed.length;
  }
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, zip({
  "[Content_Types].xml": contentTypes,
  "_rels/.rels": rootRels,
  "word/document.xml": documentXml,
  "word/styles.xml": stylesXml,
  "word/_rels/document.xml.rels": documentRels
}));
console.log(`Created ${destination}`);
