const { refusedRange } = require("../public-address");

describe("refusedRange", () => {
  it.each([
    ["127.0.0.1", "127.0.0.0/8"],
    ["127.255.255.254", "127.0.0.0/8"],
    ["10.0.0.0", "10.0.0.0/8"],
    ["10.255.255.255", "10.0.0.0/8"],
    ["172.16.0.0", "172.16.0.0/12"],
    ["172.31.255.255", "172.16.0.0/12"],
    ["192.168.0.1", "192.168.0.0/16"],
    ["169.254.169.254", "169.254.0.0/16"],
    ["169.254.170.2", "169.254.0.0/16"],
    ["100.64.0.0", "100.64.0.0/10"],
    ["100.127.255.255", "100.64.0.0/10"],
    ["0.0.0.0", "0.0.0.0/8"],
    ["0.255.255.255", "0.0.0.0/8"],
    ["224.0.0.1", "224.0.0.0/4"],
    ["255.255.255.255", "240.0.0.0/4"],
    ["::1", "::1/128"],
    ["[::1]", "::1/128"],
    ["::", "::/128"],
    ["fe80::1", "fe80::/10"],
    ["fe80::1%eth0", "fe80::/10"],
    ["febf:ffff::1", "fe80::/10"],
    ["fc00::1", "fc00::/7"],
    ["fd00:ec2::254", "fc00::/7"],
    ["ff02::1", "ff00::/8"],
    ["::ffff:127.0.0.1", "127.0.0.0/8"],
    ["::ffff:7f00:1", "127.0.0.0/8"],
    ["::FFFF:A9FE:A9FE", "169.254.0.0/16"],
    ["::ffff:10.1.2.3", "10.0.0.0/8"],
    ["::ffff:0:192.168.1.1", "192.168.0.0/16"],
    ["::172.16.0.1", "172.16.0.0/12"],
    ["64:ff9b::169.254.169.254", "169.254.0.0/16"],
    ["2002:a9fe:a9fe::1", "169.254.0.0/16"],
  ])("refuses %s (%s)", (address, cidr) => {
    expect(refusedRange(address)).toMatchObject({ cidr });
  });

  it.each(["172.15.255.255", "172.32.0.0", "100.63.255.255", "100.128.0.0", "169.253.255.255", "169.255.0.0", "11.0.0.0", "9.255.255.255", "192.169.0.0", "1.1.1.1", "93.184.215.14", "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::8.8.8.8", "2002:808:808::1", "fe00::1"])("lets %s through", (address) => {
    expect(refusedRange(address)).toBeNull();
  });

  it("names the embedded form, and lets loopback through only when asked", () => {
    expect(refusedRange("::ffff:127.0.0.1").description).toBe("a loopback address (127.0.0.0/8) in IPv4-mapped form");
    expect(refusedRange("127.0.0.1", { allowLoopback: true })).toBeNull();
    expect(refusedRange("::ffff:127.0.0.1", { allowLoopback: true })).toBeNull();
    expect(refusedRange("::1", { allowLoopback: true })).toBeNull();
    expect(refusedRange("10.0.0.1", { allowLoopback: true })).toMatchObject({ cidr: "10.0.0.0/8" });
    expect(refusedRange("169.254.169.254", { allowLoopback: true })).toMatchObject({ cidr: "169.254.0.0/16" });
    expect(refusedRange("0.0.0.0", { allowLoopback: true })).toMatchObject({ cidr: "0.0.0.0/8" });
  });

  it("refuses anything that is not an IP address", () => {
    expect(refusedRange("localhost")).toMatchObject({ description: "not an IP address" });
    expect(refusedRange("")).toMatchObject({ description: "not an IP address" });
  });
});
