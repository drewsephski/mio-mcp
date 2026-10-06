export function isOperator(user: { $id: string; status: boolean; emailVerification: boolean }, operatorId: string | undefined) {
  return !!operatorId && user.$id === operatorId && user.status === true && user.emailVerification === true;
}
