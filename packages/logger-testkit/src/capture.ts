import { Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

/** A destination for the application's actual logger, not a replacement logger. */
export function createLogCapture(): { destination: Writable; text(): string } {
  const decoder = new StringDecoder("utf8");
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(decoder.write(chunk));
      done();
    },
    final(done) {
      chunks.push(decoder.end());
      done();
    },
  });
  return { destination, text: () => chunks.join("") };
}
