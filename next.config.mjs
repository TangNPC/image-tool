import path from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const apiTarget = process.env.IMAGE_TOOLS_API_TARGET || "http://0.0.0.0:19080"

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: projectRoot,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiTarget}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
