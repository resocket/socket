import { useRouter } from "next/router";
import { useConfig } from "nextra-theme-docs";

export default {
  logo: "Resocket",
  project: {
    link: "https://github.com/resocket/socket",
  },
  chat: {
    link: "https://discord.gg/FQb86Sqxhd",
  },
  footer: {
    text: (
      <span>
        <a href="https://resocket.io">Resocket. </a> making the future of
        multiplayer devtools
      </span>
    ),
  },
  useNextSeoProps() {
    const { asPath } = useRouter();
    if (asPath !== "/") {
      return {
        titleTemplate: "%s – Resocket",
      };
    } else {
      return {
        title: "Resocket – devtools for multiplayer apps",
      };
    }
  },
  head: () => {
    const { frontMatter } = useConfig();

    return (
      <>
        <meta
          property="og:description"
          content={
            frontMatter.description ||
            "Devtools for realtime and multiplayer apps."
          }
        />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content="@resocket_io" />
        <meta name="twitter:title" content="Resocket" />
        <meta
          name="twitter:description"
          content="Devtools for realtime and multiplayer apps."
        />
      </>
    );
  },
  nextThemes: {
    defaultTheme: "dark",
  },
  docsRepositoryBase:
    "https://github.com/resocket/socket/tree/master/apps/docs",
};
