const userProperties = PropertiesService.getUserProperties();

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

// Parse the amount of an Amazon purchase from the confirmation email.
function parseAmazonPurchaseAmount(message: GoogleAppsScript.Gmail.GmailMessage): string {
  const plainBody = message.getPlainBody();
  const amountRegex = /Order Total: \$(\d+(?:\.\d{2})?)/;
  const amountMatches = amountRegex.exec(plainBody);

  if (amountMatches === null) {
    return null;
  }

  return amountMatches[1];
}

// For every Thread in the inbox label:
// - send the transaction to YNAB
// - remove the inbox label
// - add the processed label
function processInbox() {
  const processedLabel = GmailApp.getUserLabelByName(userProperties.getProperty("processed_label"));
  const inboxLabel = GmailApp.getUserLabelByName(userProperties.getProperty("inbox_label"));

  inboxLabel.getThreads().forEach(function (thread) {
    const subject = thread.getFirstMessageSubject();

    const sentMoneyRegex = /You sent \$(\d+(?:\.\d{2})?) to (?:(.*) for (.*)|(.*))/;
    const receivedMoneyRegex = /(.*) sent you \$(\d+(?:\.\d{2})?)(?: for (.*))?/;
    const cashCardPurchaseRegex = /You spent \$(\d+(?:\.\d{2})?) at (?:(.*)\. Your.*|(.*))/;
    const amazonPurchaseRegex = /Your Amazon.* order of (.*)/;

    const sentMoneyMatches = sentMoneyRegex.exec(subject);
    const receivedMoneyMatches = receivedMoneyRegex.exec(subject);
    const cashCardPurchaseMatches = cashCardPurchaseRegex.exec(subject);
    const amazonPurchaseMatches = amazonPurchaseRegex.exec(subject);

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
    } else if (amazonPurchaseMatches !== null) {
      amountMultiplier = -1;
      amountString = parseAmazonPurchaseAmount(thread.getMessages()[0]);
      payee = "Amazon";
      accountId = userProperties.getProperty("amazon_visa_account_id");
      memo = amazonPurchaseMatches[1];
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
//
// @user_property [String] budget_id the ID of the YNAB budget to create transactions within
// @user_property [String] checking_account_id the ID of the YNAB checking account to create transactions within
// @user_property [String] square_cash_account_id the ID of the YNAB Square Cash Card account to create transactions within
// @user_property [String] api_key the YNAB API key for authenticating requests, acquired from https://api.youneedabudget.com
// @user_property [String] inbox_label the label to retrieve unprocessed Cash emails from
// @user_property [String] processed_label the label to send processed Cash emails to
function main() {
  processInbox();
}
