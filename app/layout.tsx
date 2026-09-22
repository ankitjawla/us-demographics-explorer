import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "US Demographics Explorer",
  description:
    "Race, ethnicity, sex, age, education, income, poverty and housing for every US state and county — from the latest ACS 5-year release.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
