// Optional TURN relays for players behind symmetric NAT or carrier-grade cellular networks.
// Empty means STUN only, which is enough on most home Wi-Fi. To add one:
//   { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'secret' }
// These ship in the client, so use short-lived or low-quota credentials.
export const TURN_SERVERS = [];
