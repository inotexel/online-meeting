import type { NextConfig } from "next";

const config: NextConfig = {
  // The Stripe webhook needs the raw request body; Next's App Router already
  // gives us that via req.text(), so no bodyParser opt-out is required.
  reactStrictMode: true,
};

export default config;
