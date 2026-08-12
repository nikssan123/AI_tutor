import { main } from "../src/db/migrate";

main()
  .then((message) => console.log(message))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
