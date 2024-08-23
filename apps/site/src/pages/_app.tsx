import "@/styles/globals.css";
import type { AppProps } from "next/app";
import Head from "next/head";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <meta property="og:title" content="Resocket" />
        <meta
          property="og:description"
          content="Devtools for realtime and multiplayer apps."
        />
        <meta property="og:url" content="https://resocket.io" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
