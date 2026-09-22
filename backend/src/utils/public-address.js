const dns = require("dns");
const net = require("net");

/**
 * Which network addresses a request to a URL someone else chose may reach.
 *
 * On AWS the API runs inside the VPC, next to the task's credentials endpoint
 * (169.254.170.2), the instance metadata service (169.254.169.254 and
 * fd00:ec2::254) and every internal host. A URL an organisation can set — a
 * webhook — must only ever reach a public address.
 *
 * refusedRange(address) names the range an address falls in, or returns null
 * for a public one. IPv6 forms that carry an IPv4 address (mapped
 * ::ffff:a.b.c.d, translated, compatible ::a.b.c.d, NAT64 64:ff9b::/96 and
 * 6to4 2002::/16) are judged by the IPv4 address inside them.
 *
 * publicLookup() is a `lookup` for http.request: it resolves the name, refuses
 * it unless every address is public, and hands the socket exactly the
 * addresses it checked, so a DNS answer cannot change between the check and
 * the connection.
 */

const IPV4_RANGES = [
  { cidr: "0.0.0.0/8", description: 'an unspecified ("this network") address' },
  { cidr: "10.0.0.0/8", description: "a private address" },
  { cidr: "100.64.0.0/10", description: "a carrier-grade NAT address" },
  { cidr: "127.0.0.0/8", description: "a loopback address", loopback: true },
  { cidr: "169.254.0.0/16", description: "a link-local address" },
  { cidr: "172.16.0.0/12", description: "a private address" },
  { cidr: "192.0.0.0/24", description: "an IETF protocol address" },
  { cidr: "192.168.0.0/16", description: "a private address" },
  { cidr: "198.18.0.0/15", description: "a benchmarking address" },
  { cidr: "224.0.0.0/4", description: "a multicast address" },
  { cidr: "240.0.0.0/4", description: "a reserved address" },
];

const IPV6_RANGES = [
  { cidr: "::/128", description: "an unspecified address" },
  { cidr: "::1/128", description: "a loopback address", loopback: true },
  { cidr: "fc00::/7", description: "a unique-local address" },
  { cidr: "fe80::/10", description: "a link-local address" },
  { cidr: "fec0::/10", description: "a site-local address" },
  { cidr: "ff00::/8", description: "a multicast address" },
  { cidr: "64:ff9b:1::/48", description: "a local-use NAT64 address" },
  { cidr: "100::/64", description: "a discard-only address" },
];

// `at` is the hextet where the embedded IPv4 address starts.
const IPV6_EMBEDDED_IPV4 = [
  { cidr: "::ffff:0:0/96", form: "IPv4-mapped", at: 6 },
  { cidr: "::ffff:0:0:0/96", form: "IPv4-translated", at: 6 },
  { cidr: "64:ff9b::/96", form: "NAT64", at: 6 },
  { cidr: "::/96", form: "IPv4-compatible", at: 6 },
  { cidr: "2002::/16", form: "6to4", at: 1 },
];

const ipv4Number = (text) => text.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);

/** Eight 16-bit numbers; `text` must already be a valid IPv6 address. */
const ipv6Hextets = (text) => {
  let value = text;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (dotted) {
    const number = ipv4Number(dotted[1]);
    value = `${value.slice(0, -dotted[1].length)}${Math.floor(number / 65536).toString(16)}:${(number % 65536).toString(16)}`;
  }
  const [head, tail] = value.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const parts = tail === undefined ? headParts : [...headParts, ...Array(8 - headParts.length - tailParts.length).fill("0"), ...tailParts];
  return parts.map((part) => parseInt(part, 16));
};

const parseCidr4 = (range) => {
  const [base, bits] = range.cidr.split("/");
  return { ...range, base: ipv4Number(base), bits: Number(bits) };
};
const parseCidr6 = (range) => {
  const [base, bits] = range.cidr.split("/");
  return { ...range, base: ipv6Hextets(base), bits: Number(bits) };
};

const V4 = IPV4_RANGES.map(parseCidr4);
const V6 = IPV6_RANGES.map(parseCidr6);
const V6_EMBEDDED = IPV6_EMBEDDED_IPV4.map(parseCidr6);

const inRange4 = (number, { base, bits }) => Math.floor(number / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits));

const inRange6 = (hextets, { base, bits }) => {
  for (let index = 0; index < 8 && bits > index * 16; index += 1) {
    const shift = 16 - Math.min(16, bits - index * 16);
    if (hextets[index] >> shift !== base[index] >> shift) return false;
  }
  return true;
};

const describeRange = ({ cidr, description, loopback = false }) => ({ cidr, description: `${description} (${cidr})`, loopback });

const classify4 = (number) => {
  const range = V4.find((candidate) => inRange4(number, candidate));
  return range ? describeRange(range) : null;
};

const classify6 = (hextets) => {
  const range = V6.find((candidate) => inRange6(hextets, candidate));
  if (range) return describeRange(range);
  const embedding = V6_EMBEDDED.find((candidate) => inRange6(hextets, candidate));
  if (!embedding) return null;
  const inner = classify4(hextets[embedding.at] * 65536 + hextets[embedding.at + 1]);
  return inner ? { ...inner, description: `${inner.description} in ${embedding.form} form` } : null;
};

/** "[::1]" → "::1", "fe80::1%eth0" → "fe80::1". */
const bareAddress = (value) =>
  String(value || "")
    .trim()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/%.*$/, "");

/**
 * The refused range an IP address falls in — `{ cidr, description, loopback }`
 * — or null for a public address. Anything that is not an IP address is
 * refused. `allowLoopback` lets loopback through (local development only).
 */
const refusedRange = (address, { allowLoopback = false } = {}) => {
  const bare = bareAddress(address);
  const family = net.isIP(bare);
  const refusal = family === 4 ? classify4(ipv4Number(bare)) : family === 6 ? classify6(ipv6Hextets(bare.toLowerCase())) : { cidr: null, description: "not an IP address", loopback: false };
  return refusal && !(allowLoopback && refusal.loopback) ? refusal : null;
};

class AddressRefusedError extends Error {
  constructor({ hostname = null, address, refusal }) {
    super(hostname && bareAddress(hostname) !== address ? `${hostname} resolves to ${address}, ${refusal.description}` : `${address} is ${refusal.description}`);
    this.name = "AddressRefusedError";
    this.code = "ADDRESS_REFUSED";
    this.hostname = hostname;
    this.address = address;
    this.refusal = refusal;
  }
}

/**
 * Every address `hostname` resolves to (an IP literal is taken as it is),
 * rejecting with AddressRefusedError when any one of them is refused: a name
 * that answers with one public and one private address is not public.
 */
const resolvePublicAddresses = (hostname, { allowLoopback = false } = {}) =>
  new Promise((resolve, reject) => {
    const host = bareAddress(hostname);
    const judge = (addresses) => {
      for (const entry of addresses) {
        const refusal = refusedRange(entry.address, { allowLoopback });
        if (refusal) return reject(new AddressRefusedError({ hostname, address: bareAddress(entry.address), refusal }));
      }
      return resolve(addresses);
    };
    const family = net.isIP(host);
    if (family) return judge([{ address: host, family }]);
    return dns.lookup(host, { all: true }, (error, addresses) => (error ? reject(error) : judge(addresses || [])));
  });

/**
 * A `lookup` option for http.request / net.connect. Node skips `lookup` for an
 * IP literal host, so a caller must judge a literal with refusedRange itself.
 */
const publicLookup =
  ({ allowLoopback = false } = {}) =>
  (hostname, options, callback) => {
    const done = typeof options === "function" ? options : callback;
    const settings = typeof options === "function" || !options ? {} : options;
    const wanted = settings.family === "IPv4" ? 4 : settings.family === "IPv6" ? 6 : Number(settings.family) || 0;
    resolvePublicAddresses(hostname, { allowLoopback }).then(
      (addresses) => {
        const usable = wanted ? addresses.filter((entry) => entry.family === wanted) : addresses;
        if (!usable.length) return done(Object.assign(new Error(`${hostname} has no IPv${wanted} address`), { code: "ENOTFOUND", hostname }));
        return settings.all ? done(null, usable) : done(null, usable[0].address, usable[0].family);
      },
      (error) => done(error),
    );
  };

module.exports = {
  AddressRefusedError,
  bareAddress,
  publicLookup,
  refusedRange,
  resolvePublicAddresses,
};
