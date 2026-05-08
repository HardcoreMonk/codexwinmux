export interface ITimelineSessionConnectionLike {
  sessionName: string;
}

export const getTimelineSessionConnections = <TConnection extends ITimelineSessionConnectionLike>(
  connections: Iterable<readonly [unknown, TConnection]>,
  sessionName: string,
): TConnection[] => {
  const result: TConnection[] = [];
  for (const [, conn] of connections) {
    if (conn.sessionName === sessionName) result.push(conn);
  }
  return result;
};
