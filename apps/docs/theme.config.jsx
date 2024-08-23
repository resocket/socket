import { useRouter } from "next/router";

export default {
  logo: "Resocket",
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
  nextThemes: {
    defaultTheme: "dark",
  },
};
