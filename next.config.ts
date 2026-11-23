import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    agentRules: false,
    // Default is 10 MB, which cuts off attachments (limit is 25 MB).
    experimental: { proxyClientMaxBodySize: "30mb" },
};

export default nextConfig;
