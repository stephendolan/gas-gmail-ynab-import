const userProperties = PropertiesService.getUserProperties();

// This only needs to be modified and replaced for the first run, then should be deleted.
function setUserProperties(): void {
  // userProperties.setProperty("inbox_label", "Where to pull Gmail messages from for processing");
  // userProperties.setProperty("processed_label", "Where to place Gmail messages after processing");

  // userProperties.setProperty("api_token", "Which YNAB API key to use");
  // userProperties.setProperty("budget_id", "Which YNAB budget to use");
  // userProperties.setProperty("category_id", "Which YNAB category to use by default");
  // userProperties.setProperty("checking_account_id", "Which YNAB account represents the checking account");
  // userProperties.setProperty("square_cash_account_id", "Which YNAB account represents the Square Cash account");
}

// Convert a float number to YNAB's weird milliunit format
//
// @see https://api.youneedabudget.com/#formats
function toMilliunit(amount: number): string {
  let milliunitString = Utilities.formatString("%07.3f", amount);
  milliunitString = milliunitString.replace(/\./g, "");

  return milliunitString;
}

// Send a POST request to the YNAB transactions route
function sendTransactionToYNAB(amount: number, payee: string, memo: string, accountId: string): void {
  const budgetId = userProperties.getProperty("budget_id");
  const categoryId = userProperties.getProperty("category_id");
  const apiToken = userProperties.getProperty("api_token");

  const baseUrl = "https://api.youneedabudget.com/v1";
  const transactionUrl = `${baseUrl}/budgets/${budgetId}/transactions`;

  const today = new Date().toISOString();

  const data = {
    transaction: {
      account_id: accountId,
      date: today,
      amount: toMilliunit(amount),
      payee_name: payee,
      memo: memo,
      category_id: categoryId,
      cleared: "uncleared",
      flag_color: "green"
    }
  };

  const headers = {
    Authorization: "Bearer " + apiToken
  };

  let method = "post" as const;

  const options = {
    contentType: "application/json",
    headers: headers,
    method: method,
    payload: JSON.stringify(data)
  };

  UrlFetchApp.fetch(transactionUrl, options);
}

// For every Thread in the inbox label:
// - send the transaction to YNAB
// - remove the inbox label
// - add the processed label
function processInbox(): void {
  const processedLabel = GmailApp.getUserLabelByName(userProperties.getProperty("processed_label"));
  const inboxLabel = GmailApp.getUserLabelByName(userProperties.getProperty("inbox_label"));

  inboxLabel.getThreads().forEach(function (thread) {
    const subject = thread.getFirstMessageSubject();

    const sentMoneyRegex = /You sent \$(\d+(?:\.\d{2})?) to (?:(.*) for (.*)|(.*))/;
    const receivedMoneyRegex = /(.*) sent you \$(\d+(?:\.\d{2})?)(?: for (.*))?/;
    const cashCardPurchaseRegex = /You spent \$(\d+(?:\.\d{2})?) at (?:(.*)\. Your.*|(.*))/;

    const sentMoneyMatches = sentMoneyRegex.exec(subject);
    const receivedMoneyMatches = receivedMoneyRegex.exec(subject);
    const cashCardPurchaseMatches = cashCardPurchaseRegex.exec(subject);

    let amountMultiplier = 1;
    let memo = "";
    let payee = "";
    let amountString = "";
    let accountId = "";

    if (sentMoneyMatches !== null) {
      amountMultiplier = -1;
      amountString = sentMoneyMatches[1];
      payee = sentMoneyMatches[2] || sentMoneyMatches[4];
      memo = sentMoneyMatches[3] || "No Memo Found";
      accountId = userProperties.getProperty("checking_account_id");
    } else if (receivedMoneyMatches !== null) {
      amountMultiplier = 1;
      payee = receivedMoneyMatches[1];
      amountString = receivedMoneyMatches[2];
      memo = receivedMoneyMatches[3] || "No Memo Found";
      accountId = userProperties.getProperty("checking_account_id");
    } else if (cashCardPurchaseMatches !== null) {
      amountMultiplier = -1;
      amountString = cashCardPurchaseMatches[1];
      payee = cashCardPurchaseMatches[2];
      memo = "Fill me in!";
      accountId = userProperties.getProperty("square_cash_account_id");
    } else {
      Logger.log("Unable to find a valid regular expression match");
      Logger.log(subject);
      return null;
    }

    if (
      accountId === null ||
      amountString === null ||
      payee === null ||
      memo === null
    ) {
      return null;
    }

    const amount = amountMultiplier * parseFloat(amountString);

    sendTransactionToYNAB(amount, payee, memo, accountId);

    thread.removeLabel(inboxLabel);
    thread.markRead();
    thread.addLabel(processedLabel);
  });
}

// The main entrypoint for the script.
function main(): void {
  setUserProperties();
  processInbox();
}
