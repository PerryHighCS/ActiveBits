/**
 * The controller for a number guessing game where the user or computer
 * picks a secret number and the other guesses it.
 * 
 * @type GuessingGame
 */
export class GuessingGame {
    /**
     * Create a new guessing game allowing numbers from 1..maxNumber
     * @param {type} maxNumber the highest number allowed for guesses
     */
    constructor (maxNumber) {
        this.newGame(maxNumber);
    }
    
    /**
     * Get the maximum possible number for this guessing game
     * @returns {Number}
     */
    get max() {
        return this.maxNum;
    }
    
    /**
     * Get the maximum number of guesses that it should take to guess the number
     * @returns {Number}
     */
    get guessLimit() {
        return this.maxGuesses;
    };
    
    /**
     * Get the history of all guesses the user has made in this game
     * @returns {Array}
     */
    get userHistory() {
        return this.userGuesses;
    }
    
    /**
     * Get the number the user is guessing
     * @returns {Number}
     */
    get secretNumber() {
        return this.secretNum;
    }
    
    /**
     * Initialize (restart) a new guessing game
     * @param {Number} maxNumber the highest number to allow for guessing
     * @returns {undefined}
     */
    newGame(maxNumber) {
        this.maxNum = maxNumber;
        this.maxGuesses = Math.ceil(Math.log2(maxNumber));
        this.userGuesses = [];
        this.guesses = [];

        this.secretNum = Math.ceil(Math.random() * maxNumber);
        
        this.guessMin = 1;
        this.guessMax = maxNumber;
    };
    
    /**
     * The user has made a guess, evaluate it.
     * 
     * @param {Number} guess the number the player guessed
     * @returns {undefined|Object} undefined if the number is invalid,
     *          An object with properties val: the number guessed,
     *          prompt: the relation of the secret number to that guess
     */
    madeGuess(guess) {
        if (guess === undefined || guess === "") {
            return;
        }

        guess = parseInt(guess);
        
        if (guess < 1) {
            guess = 1;
        }
        else if (guess > this.maxNum) {
            guess = this.maxNum;
        }
        
        let rval = "";
        let repeat = false;
        
        
        if (this.secretNum > guess) {
            rval = "HIGHER";
        }
        else if (this.secretNum < guess) {
            rval = "LOWER";
        }
        else {
            rval = "GOT IT!";
        }
        
        // If the user has not already guessed this number, add it to the list
        if (this.userGuesses.find(x => x.val === guess) === undefined) {            
            this.userGuesses.push({val: guess, prompt: rval});
        }
        
        return rval;
    };
    
    /**
     * Have the computer generate a guess for a user's secret number
     * 
     * @returns {Number} the number the computer guessed
     */
    makeGuess() {
        if (this.guessMin > this.guessMax) {
            return -1;
        }
        
        this.guess = Math.floor((this.guessMax + this.guessMin) / 2);
        
        return this.guess;
    }
    
    /**
     * Get the list of guesses the computer has made and their evaluations
     * @returns {Array} The history of the computer's guesses
     */
    get guessHistory() {
        return this.guesses;
    }
    
    /**
     * Have the computer guess again, this time a higher number
     * 
     * @returns {Number} The computer's guess
     */
    guessHigher() {
        this.guesses.push({val: this.guess, prompt: "HIGHER"});
        this.guessMin = this.guess + 1;
        
        return this.makeGuess();
    }
    
    /**
     * Have the computer guess again, this time a lower number
     * 
     * @returns {Number} The computer's guess
     */
    guessLower() {
        this.guesses.push({val: this.guess, prompt: "LOWER"});
        this.guessMax = this.guess - 1;
        
        return this.makeGuess();
    }
    
    /**
     * The computer's guess was correct. Mark it in the history
     * 
     * @returns {undefined}
     */
    guessGood() {
        if (this.guesses.length === 0 || 
                this.guesses[this.guesses.length - 1].val !== this.guess) {
            this.guesses.push({val: this.guess, prompt: "GOT IT!"});
        }       
    }
}