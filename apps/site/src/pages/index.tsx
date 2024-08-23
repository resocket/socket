import Head from "next/head";

export default function Home() {
  return (
    <>
      <Head>
        <title>Resocket - Devtools for multiplayer projects</title>
      </Head>

      <div className="min-h-screen flex flex-col items-center justify-center p-6">
        {/* Main Content */}
        <div className="text-center max-w-2xl">
          <h1 className="text-4xl font-bold flex items-center text-center justify-center text-white mb-4">
            <span>
              <img
                className="h-10 mr-2"
                src="/logo-white.png"
                alt="Resocket Logo"
              />
            </span>
            Resocket
          </h1>
          <p className="text-lg text-gray-300 mb-4">
            At Resocket, we're creating devtools for real-time and multiplayer
            applications. We're actively looking for early adopters and design
            partners to help shape the future of our tools.
          </p>
          <p className="text-lg text-gray-300 mb-4">
            We’ve just released our first open-source package:
          </p>
          <p className="text-lg text-white font-semibold mb-6">
            <a
              href="https://github.com/resocket/socket"
              className="text-blue-400 hover:underline"
            >
              Socket
            </a>{" "}
            — a better reconnecting WebSocket library for everyone, focused on
            enhancing developer experience.
          </p>
          <p className="text-lg text-gray-300 mb-4">
            Join our
            <a
              href="https://discord.gg/FQb86Sqxhd"
              className="text-blue-400 hover:underline"
            >
              {" "}
              Discord{" "}
            </a>
            server for early updates, getting early access, and to connect with
            the Resocket community.
          </p>
          <p className="text-lg text-gray-300">
            We’re also open to business collaborations. If you're interested,
            reach out to us at{" "}
            <a
              href="mailto:shibru127@gmail.com"
              className="text-blue-400 hover:underline"
            >
              shibru127@gmail.com
            </a>
            .
          </p>
        </div>

        {/* Join Discord Button at the Bottom */}
        <div className="mt-12">
          <a
            href="https://discord.gg/FQb86Sqxhd"
            className="bg-blue-600 text-white py-2 px-6 rounded-full shadow-lg hover:bg-blue-700 transition duration-300"
          >
            Join Our Discord
          </a>
        </div>
      </div>
    </>
  );
}
