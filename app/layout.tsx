import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

export const metadata: Metadata = {
  title: "Operation Ducks | Field explorer",
  description: "Explore farmland and map field boundaries.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}

