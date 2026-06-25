import type { Metadata } from "next";
import { Inter, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const plexThai = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-plex-thai",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SalesMate — ผู้ช่วยขายอัจฉริยะ",
  description:
    "ผู้ช่วยขาย AI + กล่องแชตรวมหลายแพลตฟอร์ม ช่วยตอบลูกค้าและขายพ่วงให้ร้านแชต",
};

// ธีมมืดเป็นค่าเริ่มต้น (เปลี่ยนเป็นสว่างเฉพาะเมื่อผู้ใช้เลือกเอง) — ตั้งก่อน paint กันจอกระพริบ
const themeInit = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'){document.documentElement.classList.add('dark');}}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="th"
      className={`${inter.variable} ${plexThai.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
