import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "พ่วง — ผู้ช่วยเสนอขายพ่วง",
  description:
    "เครื่องมือช่วยแอดมินร้านแชตเจนประโยคขายพ่วง (cross-sell/upsell) แบบ human-in-the-loop",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
