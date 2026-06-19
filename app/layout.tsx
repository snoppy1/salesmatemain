import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "พ่วง — ผู้ช่วยเสนอขายพ่วง",
  description:
    "เครื่องมือช่วยแอดมินร้านแชตเจนประโยคขายพ่วง (cross-sell/upsell) แบบ human-in-the-loop",
};

// ตั้งคลาส .dark ก่อน paint กันจอกระพริบ (อ่านจาก localStorage / ค่าระบบ)
const themeInit = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
