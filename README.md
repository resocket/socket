# Socket: A Better Reconnecting WebSocket

<img src="https://github.com/resocket/test-assets/blob/master/assets/resocket-logo-rb.png?raw=true" align="right" alt="Socket logo" width="120" height="145">

**Socket** is an open-source, developer-friendly reconnecting WebSocket library for JavaScript, designed to enhance your development experience (DX).

### Key Features:

- **Authentication** and **Dynamic URL** support
- Built-in APIs for **Connection Status** and **Lost Connection** handling
- Easy configuration for **Heartbeats** (PING/PONG)
- Listens to **Network** and **Focus** events (configurable)
- Flexible **Stop Retry** options for managing reconnections
- Customizable **Reconnection Delays**
- **Buffering** support during offline periods

### Documentation

You can find the documentation for Socket [here](https://socket-bfm.pages.dev/socket/quickstart).

### Motivation

Hi, I’m [Ace](https://github.com/dev-badace), currently working on a next-gen multiplayer framework for real-time and collaborative apps. My mission is to greatly improve the developer experience (DevEx) for creating multiplayer and real-time applications, and this is my first release!

Reconnecting WebSockets are challenging—getting them right is even harder. Adding features like heartbeats and other complexities makes it even more error-prone. Throughout my career, I've seen countless reconnecting WebSocket implementations that _work_, but often have edge case bugs and race conditions. Even the best ones aren't immune (like the Liveblocks WebSocket bug I discovered and helped fix: [issue](https://github.com/liveblocks/liveblocks/issues/1459) & [PR](https://github.com/liveblocks/liveblocks/pull/1463)).

With this project, I aim to provide the community with a DevEx-focused reconnecting WebSocket library that simplifies everything. And if bugs or edge cases are found, they’ll be fixed—for everyone.

If you’re interested in trying out a new framework, join our [Discord](https://discord.gg/FQb86Sqxhd) for early access. I’m also looking for early adopters. To set expectations, it’ll likely be open-source but behind a paid license for commercial usage (maybe ^^).

### Stay Connected

If you find Socket useful, please consider starring this repository on GitHub! Your support helps others discover the project.

You can also follow me on Twitter [@\_shibru\_](https://x.com/_shibru_) for updates and feel free to share this project with your network. Let’s make real-time web development smoother together!

### Acknowledgements

This project takes inspiration from some of my past works [reconnecting websocket (counter machine pattern)](https://github.com/dev-badace/party-socket-test) & [partyworks's implementation](https://github.com/Partywork/partyworks/tree/master/packages/partyworks-socket). and the APIs are also hugely inspired by [liveblocks](https://liveblocks.io) (it's a team whose work I respect and admire alot). also thankx to [@threepointone](https://x.com/threepointone) for sponsoring this in the past.

Resocket ~ Ace
