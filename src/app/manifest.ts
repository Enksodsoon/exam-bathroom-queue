import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ExamQ · Bathroom Queue",
    short_name: "ExamQ",
    description: "Live exam bathroom queue coordination with real-time alerts.",
    start_url: "/",
    display: "standalone",
    background_color: "#F6F8FA",
    theme_color: "#0F172A",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
