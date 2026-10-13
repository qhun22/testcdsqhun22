import { deflateRawSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const destination = resolve("docs/huong-dan-them-chatbot-ai.docx");
const paragraphs = [];
const escapeXml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);

function addParagraph(text, style = "Normal", options = {}) {
  const runs = String(text).split("\n").map((part, index) => `${index ? "<w:br/>" : ""}<w:r><w:rPr><w:lang w:val="vi-VN"/>${options.bold ? "<w:b/>" : ""}${options.color ? `<w:color w:val="${options.color}"/>` : ""}</w:rPr><w:t xml:space="preserve">${escapeXml(part)}</w:t></w:r>`).join("");
  const paragraphProperties = `<w:pStyle w:val="${style}"/>${options.center ? "<w:jc w:val=\"center\"/>" : ""}${options.shading ? `<w:shd w:fill="${options.shading}"/>` : ""}${options.indent ? "<w:ind w:left=\"240\" w:right=\"180\"/>" : ""}${options.keepNext ? "<w:keepNext/>" : ""}`;
  paragraphs.push(`<w:p><w:pPr>${paragraphProperties}</w:pPr>${runs}</w:p>`);
}

function heading(value, level = 1) { addParagraph(value, `Heading${level}`, { keepNext: true }); }
function bullet(value) { addParagraph(`• ${value}`, "ListParagraph"); }
function code(value) { addParagraph(value, "CodeBlock", { shading: "EEF1EA" }); }
function step(number, title, detail) {
  addParagraph(`${number}. ${title}`, "Heading2", { keepNext: true });
  addParagraph(detail);
}

addParagraph("HƯỚNG DẪN CHATBOT AI", "Title", { center: true });
addParagraph("TÍCH HỢP VÀO WEBSITE CHỢ NHÀ · CLOUDFLARE WORKERS", "Subtitle", { center: true });
addParagraph("Tài liệu này hướng dẫn cách chatbot được tích hợp vào cửa hàng: khách mở khung chat, hỏi về sản phẩm hoặc đặt hàng; Worker tra cứu D1, gọi Workers AI và gửi câu trả lời về giao diện.");
addParagraph("Ngày cập nhật: 05/10/2026");
addParagraph("Website hiện tại: https://cho-nha-commerce.kirinhoang.workers.dev", "Note");

heading("1. Cấu trúc hoạt động");
bullet("apps/storefront/index.html đặt nút mở chat và khung hội thoại; apps/storefront/chatbot.css tạo giao diện thích ứng với điện thoại.");
bullet("apps/storefront/store.js gửi tin nhắn đến /api/chat, hiển thị câu trả lời và sản phẩm gợi ý; khách có thể thêm món vào giỏ ngay trong chat.");
bullet("apps/api/src/index.js kiểm tra yêu cầu, tìm sản phẩm còn hàng trong D1 và gọi Workers AI để tạo câu trả lời.");
bullet("wrangler.jsonc khai báo binding AI và DB. Khóa bí mật không được gửi xuống trình duyệt.");
addParagraph("Luồng xử lý: Khách → khung chat → POST /api/chat → Worker + D1 + Workers AI → câu trả lời và sản phẩm → giao diện.", "Note");

heading("2. Thêm giao diện chatbot");
step(1, "Nạp stylesheet riêng", "Trong apps/storefront/index.html, thêm chatbot.css cùng stylesheet cửa hàng.");
code('<link rel="stylesheet" href="/chatbot.css">');
step(2, "Thêm nút mở chat", "Đặt nút nổi ở cuối trang. Thuộc tính aria-controls và aria-expanded giúp nút có tên và trạng thái cho trình đọc màn hình.");
code('<button id="chat-launcher" aria-controls="chat-panel" aria-expanded="false">\n  Hỏi Chợ Nhà\n</button>');
step(3, "Thêm khung hội thoại", "Panel gồm tiêu đề, vùng log tin nhắn, ô nhập và nút gửi. Đặt hidden ban đầu để panel không che nội dung cửa hàng.");
code('<section id="chat-panel" aria-label="Trợ lý Chợ Nhà" hidden>\n  <div id="chat-messages" role="log" aria-live="polite"></div>\n  <form id="chat-form">...</form>\n</section>');
addParagraph("Giữ chatbot trên cùng trang cửa hàng, không tạo website hoặc route mới. CSS cố định nút ở góc dưới, giới hạn chiều cao khung và dùng breakpoint cho màn hình hẹp.");

heading("3. Gửi tin nhắn từ trình duyệt");
step(1, "Quản lý sự kiện", "Trong apps/storefront/store.js, nút mở/đóng cập nhật hidden, aria-hidden và aria-expanded. Khi mở chat, focus vào ô nhập.");
step(2, "Gọi cùng origin", "Form gửi tin nhắn và vài lượt hội thoại gần nhất đến Worker. Dùng đường dẫn tương đối để website vẫn chạy trên URL hiện tại.");
code('fetch("/api/chat", {\n  method: "POST",\n  headers: { "content-type": "application/json" },\n  body: JSON.stringify({ message, history })\n});');
step(3, "Hiển thị an toàn", "Dùng textContent để hiện nội dung do AI trả về, không chèn câu trả lời dưới dạng HTML. Dựng kết quả sản phẩm bằng DOM và nối nút + với dữ liệu sản phẩm thật.");

heading("4. Xây endpoint Worker");
step(1, "Đăng ký API", "Trong apps/api/src/index.js, định tuyến POST /api/chat vào hàm chat.");
code('if (path === "/api/chat" && method === "POST") return chat(request, env);');
step(2, "Kiểm tra đầu vào", "Từ chối tin nhắn rỗng hoặc dài hơn 500 ký tự; chỉ nhận vai trò user/assistant; giữ lịch sử ngắn để giới hạn dữ liệu gửi tới model.");
step(3, "Giới hạn gửi", "Endpoint giới hạn 12 lượt mỗi địa chỉ IP trong một phút tại từng isolate. Đây là giới hạn cơ bản; có thể bổ sung Cloudflare Rate Limiting cho quy mô lớn.");
step(4, "Tìm sản phẩm", "Khi nhận ra ý định tìm món, truy vấn D1 với stock > 0. Các từ khóa được so khớp không phân biệt dấu; nhiều từ trong truy vấn cần có ít nhất hai từ khớp để tránh gợi ý sản phẩm chỉ trùng một từ. Worker trả về tối đa bốn sản phẩm cùng giá, tồn kho và ảnh.");
step(5, "Gọi model", "Nếu binding AI khả dụng, Worker gửi system prompt cùng lịch sử gần nhất và sản phẩm tìm thấy.");
code('env.AI.run("@cf/meta/llama-3.2-3b-instruct", {\n  messages: [systemMessage, ...recentHistory],\n  max_tokens: 220\n});');
bullet("Prompt yêu cầu trả lời tiếng Việt, không bịa phí/thời gian giao, chính sách đổi trả hoặc thông tin liên hệ.");
bullet("FAQ dự phòng vẫn hỗ trợ tìm món, thanh toán và hướng dẫn đặt hàng nếu model gặp lỗi.");
bullet("Chatbot chỉ tư vấn; không tự tạo đơn hoặc xác nhận trạng thái thanh toán.");

heading("5. Cấu hình Cloudflare");
addParagraph("wrangler.jsonc cần binding AI và binding D1 DB trỏ đến database_id của cửa hàng. Cấu hình AI tối thiểu:");
code('"ai": { "binding": "AI" }');
addParagraph("Workers AI chạy ở phía Cloudflare. Bật Workers AI cho tài khoản trước khi deploy. Mỗi lần suy luận có thể phát sinh phí; không đưa ADMIN_TOKEN hay thông tin nhận hàng vào prompt.", "Warning");

heading("6. Kiểm tra và deploy");
addParagraph("Mở PowerShell tại thư mục dự án có package.json. Các lệnh sau kiểm tra cú pháp và đưa Worker cùng giao diện lên Cloudflare:");
code('npx.cmd wrangler whoami\nnode --check apps/api/src/index.js\nnode --check apps/storefront/store.js\nnpm.cmd run deploy');
bullet("Xác nhận Wrangler đăng nhập đúng tài khoản, cấu hình AI binding và D1 DB đúng cửa hàng.");
bullet("Chỉ chạy npx.cmd wrangler d1 migrations apply cho-nha-db --remote khi có migration mới. Không chạy migration chỉ để deploy mã chatbot.");
bullet("Cuối lệnh deploy, dùng hostname Wrangler in ra. Website Chợ Nhà hiện tại: https://cho-nha-commerce.kirinhoang.workers.dev.");

heading("7. Kiểm thử sau deploy");
bullet("Mở website, xác nhận nút chat xuất hiện và panel hoạt động trên máy tính lẫn điện thoại.");
bullet("Thử hỏi “Tìm cà chua giúp mình”; xác nhận chỉ hiện món phù hợp, đúng giá và nút + thêm được vào giỏ.");
bullet("Hỏi về đặt hàng/thanh toán; xác nhận câu trả lời nói rõ đơn chờ cửa hàng xác nhận và chưa có thanh toán trực tuyến.");
bullet("Mở https://cho-nha-commerce.kirinhoang.workers.dev/api/health; phản hồi thành công là {" + '"ok":true' + "}.");
bullet("Nếu gặp lỗi AI, xem log bằng npx.cmd wrangler tail cho-nha-commerce. Kiểm tra model ID trong danh mục Workers AI hiện hành.");

heading("8. Bảo mật và bảo trì");
bullet("Không để khóa bí mật hoặc token quản trị trong apps/storefront; AI chỉ được gọi từ Worker qua binding.");
bullet("Không để chatbot truy cập API quản trị. API /api/admin/* vẫn phải yêu cầu ADMIN_TOKEN.");
bullet("Giới hạn độ dài tin nhắn/lịch sử, theo dõi mức sử dụng AI và bổ sung rate limit ở Cloudflare nếu lưu lượng tăng.");
bullet("Nếu đổi model, cập nhật ID trong apps/api/src/index.js, chạy node --check rồi deploy và thử một câu hỏi trên URL public.");

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="900" w:right="1000" w:bottom="900" w:left="1000"/></w:sectPr></w:body></w:document>`;
const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="21"/><w:color w:val="26332C"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="280" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:rFonts w:ascii="Aptos Display" w:hAnsi="Aptos Display"/><w:b/><w:color w:val="345B47"/><w:sz w:val="38"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:rPr><w:b/><w:color w:val="D8734B"/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="345B47"/><w:sz w:val="27"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="70"/></w:pPr><w:rPr><w:b/><w:color w:val="26332C"/><w:sz w:val="23"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="240"/><w:spacing w:after="90"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="180" w:right="180"/><w:spacing w:before="50" w:after="150"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/><w:color w:val="26332C"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:fill="F3F6EF"/><w:ind w:left="180" w:right="180"/></w:pPr><w:rPr><w:color w:val="345B47"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Warning"><w:name w:val="Warning"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:fill="FFF3E8"/><w:ind w:left="180" w:right="180"/></w:pPr></w:style></w:styles>`;
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