/** @type {import('next').NextConfig} */

// Content-Security-Policy — เผื่อทุกอย่างที่แอปใช้จริง ไม่ให้หน้าพัง:
// - script/style 'unsafe-inline': theme-init script ใน layout + inline hydration ของ Next + style={{}} ใน React/Tailwind
// - img https:/data:/blob: : รูปแชตจาก Vercel Blob + CDN มาร์เก็ตเพลส (slatic.net/graph.facebook.com ฯลฯ) + รูปสินค้า data URL
// - font/style fonts.g*: เผื่อฟอนต์ Google (แอปใช้ next/font self-host อยู่แล้ว แต่ใส่ไว้กันพลาด)
// - frame-ancestors 'none' = กัน clickjacking (คู่กับ X-Frame-Options)
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' https://fonts.gstatic.com data:",
  "connect-src 'self' https:",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=(), usb=()",
  },
];

const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
