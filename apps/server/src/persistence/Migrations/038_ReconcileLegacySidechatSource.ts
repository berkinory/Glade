import * as Effect from "effect/Effect";

import ProjectionThreadsSidechatSource from "./033_ProjectionThreadsSidechatSource.ts";

export default Effect.gen(function* () {
  yield* ProjectionThreadsSidechatSource;
});
