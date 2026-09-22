/**
 * Builds a fake Mongoose query: a resolved Promise that also exposes the
 * chainable query methods (sort/limit/lean/skip) routes call before awaiting.
 * Every chain call returns the same promise so `.find().sort().lean()` and
 * a bare `await Model.find()` both resolve to `value`.
 */
export function mockQuery<T>(value: T) {
  const promise = Promise.resolve(value) as Promise<T> & {
    sort: jest.Mock;
    limit: jest.Mock;
    lean: jest.Mock;
    skip: jest.Mock;
  };
  promise.sort = jest.fn().mockReturnValue(promise);
  promise.limit = jest.fn().mockReturnValue(promise);
  promise.lean = jest.fn().mockReturnValue(promise);
  promise.skip = jest.fn().mockReturnValue(promise);
  return promise;
}
